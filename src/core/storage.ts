import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { validateWorkspace } from "./import";
import type { Folder, Note, Workspace } from "./types";

export const DATABASE_NAME = "folio-notes";
interface Metadata {
  key: "workspace";
  schemaVersion: 1;
  folders: Folder[];
  noteIds?: string[];
  revision: number;
  updatedAt: string;
}
interface Snapshot {
  key: "previous";
  workspace: Workspace;
  at: string;
}
interface FolioDatabase extends DBSchema {
  notes: { key: string; value: Note };
  meta: { key: string; value: Metadata };
  recovery: { key: string; value: Snapshot };
}

export class StorageConflictError extends Error {
  constructor() {
    super(
      "別のタブでノートが更新されました。このタブの内容をバックアップしてから、ページを再読み込みしてください。上書きを防ぐため編集を停止しています。",
    );
    this.name = "StorageConflictError";
  }
}

let database: Promise<IDBPDatabase<FolioDatabase>> | null = null;
function getDatabase(): Promise<IDBPDatabase<FolioDatabase>> {
  if (!globalThis.indexedDB)
    return Promise.reject(
      new Error(
        "このブラウザでは端末内保存を利用できません。通常のSafariまたはChromeで開いてください。",
      ),
    );
  if (!database)
    database = openDB<FolioDatabase>(DATABASE_NAME, 1, {
      upgrade(db) {
        db.createObjectStore("notes", { keyPath: "id" });
        db.createObjectStore("meta", { keyPath: "key" });
        db.createObjectStore("recovery", { keyPath: "key" });
      },
      blocked() {
        /* Existing connection remains safe; the open request will resolve after it closes. */
      },
      blocking() {
        void database?.then((db) => db.close());
        database = null;
      },
      terminated() {
        database = null;
      },
    }).catch((error) => {
      database = null;
      throw error;
    });
  return database;
}

export interface LoadedWorkspace {
  workspace: Workspace | null;
  revision: number;
  recovered: boolean;
}
function orderNotes(notes: Note[], metadata: Metadata): Note[] {
  const positions = new Map(
    (metadata.noteIds || []).map((id, index) => [id, index]),
  );
  return [...notes].sort(
    (a, b) =>
      (positions.get(a.id) ?? a.order) - (positions.get(b.id) ?? b.order),
  );
}
function unchanged(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left),
    b = Object.keys(right);
  if (a.length !== b.length) return false;
  return a.every(
    (key) =>
      Object.hasOwn(right, key) &&
      unchanged(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      ),
  );
}
export async function loadWorkspace(): Promise<LoadedWorkspace> {
  const db = await getDatabase();
  const transaction = db.transaction(["notes", "meta", "recovery"], "readonly");
  const [notes, metadata, snapshot] = await Promise.all([
    transaction.objectStore("notes").getAll(),
    transaction.objectStore("meta").get("workspace"),
    transaction.objectStore("recovery").get("previous"),
  ]);
  await transaction.done;
  if (!metadata && notes.length === 0 && !snapshot)
    return { workspace: null, revision: 0, recovered: false };
  const revision =
    typeof metadata?.revision === "number" &&
    Number.isSafeInteger(metadata.revision) &&
    metadata.revision >= 0
      ? metadata.revision
      : 0;
  try {
    if (
      !metadata ||
      metadata.schemaVersion !== 1 ||
      !Number.isSafeInteger(metadata.revision) ||
      metadata.revision < 1
    )
      throw new Error("metadata");
    return {
      workspace: validateWorkspace({
        schemaVersion: 1,
        folders: metadata.folders,
        notes: orderNotes(notes, metadata),
      }),
      revision,
      recovered: false,
    };
  } catch {
    if (snapshot) {
      try {
        return {
          workspace: validateWorkspace(snapshot.workspace),
          revision,
          recovered: true,
        };
      } catch {
        /* Preserve the database for manual recovery. */
      }
    }
    throw new Error(
      "保存データを読み込めませんでした。元データは削除していません。ページを再読み込みするか、保管済みのバックアップから復元してください。",
    );
  }
}

/** A single transaction commits metadata, changed notes, deletions and recovery checkpoint. */
export async function saveWorkspace(
  workspace: Workspace,
  expectedRevision: number,
): Promise<number> {
  const validated = validateWorkspace(workspace);
  const db = await getDatabase();
  const transaction = db.transaction(
    ["notes", "meta", "recovery"],
    "readwrite",
    { durability: "strict" },
  );
  const completed = transaction.done;
  // Observe aborts even if a synchronous request exception happens before the final await.
  void completed.catch(() => undefined);
  try {
    const noteStore = transaction.objectStore("notes"),
      metaStore = transaction.objectStore("meta");
    const [metadata, storedNotes] = await Promise.all([
      metaStore.get("workspace"),
      noteStore.getAll(),
    ]);
    const actualRevision =
      typeof metadata?.revision === "number" &&
      Number.isSafeInteger(metadata.revision) &&
      metadata.revision >= 0
        ? metadata.revision
        : 0;
    if (actualRevision !== expectedRevision) {
      transaction.abort();
      await transaction.done.catch(() => undefined);
      throw new StorageConflictError();
    }
    if (metadata) {
      let previous: Workspace | null = null;
      try {
        previous = validateWorkspace({
          schemaVersion: metadata.schemaVersion,
          notes: orderNotes(storedNotes, metadata),
          folders: metadata.folders,
        });
      } catch {
        /* Keep the existing known-good recovery snapshot when repairing corrupt data. */
      }
      // A failed write must abort the whole commit, including a failed checkpoint write.
      if (previous)
        await transaction
          .objectStore("recovery")
          .put({
            key: "previous",
            workspace: previous,
            at: new Date().toISOString(),
          });
    }
    const existing = new Map(storedNotes.map((note) => [note.id, note]));
    const incoming = new Set(validated.notes.map((note) => note.id));
    for (const note of validated.notes)
      if (!unchanged(existing.get(note.id), note)) await noteStore.put(note);
    for (const note of storedNotes)
      if (!incoming.has(note.id)) await noteStore.delete(note.id);
    const revision = actualRevision + 1;
    await metaStore.put({
      key: "workspace",
      schemaVersion: 1,
      folders: validated.folders,
      noteIds: validated.notes.map((note) => note.id),
      revision,
      updatedAt: new Date().toISOString(),
    });
    await completed;
    return revision;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      /* Already completed or aborted. */
    }
    await completed.catch(() => undefined);
    throw error;
  }
}

export function storageErrorMessage(error: unknown): string {
  if (error instanceof StorageConflictError) return error.message;
  if (
    error instanceof DOMException &&
    ["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"].includes(error.name)
  )
    return "保存容量が足りません。現在の内容をバックアップしてから、不要な画像やノートを整理してください。変更はまだこの画面に残っています。";
  return `${error instanceof Error ? error.message : "端末内への保存に失敗しました。"} 変更は自動的に消去していません。バックアップを作成してから再試行してください。`;
}

/** Closing is also useful before database migrations and in isolated tests. */
export async function closeStorage(): Promise<void> {
  const pending = database;
  database = null;
  if (pending) {
    try {
      (await pending).close();
    } catch {
      /* An unsuccessful open has no connection to close. */
    }
  }
}
