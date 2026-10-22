import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import {
  DATABASE_NAME,
  closeStorage,
  loadWorkspace,
  saveWorkspace,
  StorageConflictError,
  storageErrorMessage,
} from "../src/core/storage";
import { seedWorkspace } from "../src/core/seed";

async function removeDatabase() {
  await closeStorage();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
beforeEach(removeDatabase);
afterEach(async () => {
  vi.restoreAllMocks();
  await closeStorage();
});

describe("transactional local storage", () => {
  it("stores changes and reloads all note data after reopening the database", async () => {
    expect((await loadWorkspace()).workspace).toBeNull();
    const workspace = seedWorkspace();
    const initial = await saveWorkspace(workspace, 0);
    workspace.notes[0].title = "保存された日本語";
    workspace.notes[1].deletedAt = new Date().toISOString();
    await saveWorkspace(workspace, initial);
    await closeStorage();
    expect((await loadWorkspace()).workspace).toEqual(workspace);
  });

  it("rejects stale revisions so another tab cannot silently overwrite notes", async () => {
    const initial = seedWorkspace();
    await saveWorkspace(initial, 0);
    const a = await loadWorkspace(),
      b = await loadWorkspace();
    a.workspace!.notes[0].title = "タブAの更新";
    await saveWorkspace(a.workspace!, a.revision);
    b.workspace!.notes[0].title = "古いタブBの内容";
    await expect(
      saveWorkspace(b.workspace!, b.revision),
    ).rejects.toBeInstanceOf(StorageConflictError);
    expect((await loadWorkspace()).workspace!.notes[0].title).toBe(
      "タブAの更新",
    );
  });

  it("writes only the changed note record while committing metadata and a recovery snapshot", async () => {
    const initial = seedWorkspace();
    await saveWorkspace(initial, 0);
    const originalPut = IDBObjectStore.prototype.put,
      writtenNotes: string[] = [];
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "notes")
        writtenNotes.push((args[0] as { id: string }).id);
      return originalPut.apply(this, args);
    });
    const updated = structuredClone(initial);
    updated.notes[1].title = "このノートだけ更新";
    await saveWorkspace(updated, 1);
    expect(writtenNotes).toEqual([updated.notes[1].id]);
  });

  it("recovers a previous good snapshot without silently seeding over corruption", async () => {
    const initial = seedWorkspace();
    await saveWorkspace(initial, 0);
    const updated = structuredClone(initial);
    updated.notes[0].title = "更新";
    await saveWorkspace(updated, 1);
    const db = await openDB(DATABASE_NAME, 1);
    await db.put("notes", { ...updated.notes[0], title: null });
    db.close();
    const recovered = await loadWorkspace();
    expect(recovered.recovered).toBe(true);
    expect(recovered.workspace!.notes[0].title).toBe(initial.notes[0].title);
    await saveWorkspace(recovered.workspace!, recovered.revision);
    expect((await loadWorkspace()).recovered).toBe(false);
  });

  it("leaves a failed commit fully unchanged, including the previous saved revision", async () => {
    const initial = seedWorkspace();
    await saveWorkspace(initial, 0);
    const modified = structuredClone(initial);
    modified.notes[0].title = "保存できない内容";
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "notes") {
        this.transaction.abort();
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      }
      return originalPut.apply(this, args);
    });
    await expect(saveWorkspace(modified, 1)).rejects.toThrow();
    vi.restoreAllMocks();
    const loaded = await loadWorkspace();
    expect(loaded.revision).toBe(1);
    expect(loaded.workspace).toEqual(initial);
    expect(
      storageErrorMessage(new DOMException("full", "QuotaExceededError")),
    ).toContain("バックアップ");
  });

  it("does not reset unrecoverable data", async () => {
    await saveWorkspace(seedWorkspace(), 0);
    const db = await openDB(DATABASE_NAME, 1);
    await db.put("notes", { id: "bad", title: null });
    db.close();
    await expect(loadWorkspace()).rejects.toThrow("元データは削除していません");
    const inspection = await openDB(DATABASE_NAME, 1);
    expect(await inspection.get("notes", "bad")).toEqual({
      id: "bad",
      title: null,
    });
    inspection.close();
  });
});
