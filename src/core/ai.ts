import { sanitizeHtml, isSafeImageUrl } from "./import";
import {
  uid,
  type Block,
  type BlockType,
  type Folder,
  type Note,
  type Workspace,
} from "./types";

/** This is a local domain API. No network listener, AI provider or credentials are involved. */
export interface BlockInput {
  id?: string;
  type: BlockType;
  html?: string;
  src?: string;
  name?: string;
  width?: number;
  caption?: string;
}
type Expected = { noteId: string; expectedUpdatedAt: string };
export type ProposalOperation =
  | { op: "create_folder"; id?: string; name: string; parentId?: string | null }
  | { op: "rename_folder"; folderId: string; name: string }
  | { op: "move_folder"; folderId: string; parentId: string | null }
  | {
      op: "create_note";
      id?: string;
      title: string;
      folderId?: string | null;
      tags?: string[];
      blocks?: BlockInput[];
    }
  | (Expected & {
      op: "edit_note";
      title?: string;
      tags?: string[];
      favorite?: boolean;
      pinned?: boolean;
      sourceUrl?: string;
    })
  | (Expected & { op: "append_note"; blocks: BlockInput[] })
  | (Expected & { op: "move_note"; folderId: string | null })
  | (Expected & { op: "add_blocks"; blocks: BlockInput[]; index?: number })
  | (Expected & { op: "edit_block"; blockId: string; block: BlockInput })
  | (Expected & { op: "delete_blocks"; blockIds: string[] })
  | (Expected & {
      op: "move_blocks";
      blockIds: string[];
      toNoteId: string;
      toExpectedUpdatedAt: string;
      index?: number;
    })
  | (Expected & { op: "trash_note" });
export interface ChangeProposal {
  version: 1;
  operations: ProposalOperation[];
}
export interface ProposalPreview {
  summary: string[];
  next: Workspace;
}

const TYPES: BlockType[] = [
  "text",
  "heading",
  "image",
  "table",
  "code",
  "quote",
  "divider",
  "math",
  "html",
];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fail = (message: string): never => {
  throw new Error(message);
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("JSON のオブジェクトが必要です。");
  return value as Record<string, unknown>;
};
function keys(value: Record<string, unknown>, allowed: string[]) {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) fail(`未対応の項目です: ${unexpected}`);
}
function str(value: unknown, label: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(`${label}を ${max} 文字以内で指定してください。`);
  return value as string;
}
function id(value: unknown, label = "ID"): string {
  return str(value, label, 200);
}
function nullableId(value: unknown): string | null {
  return value === null || value === undefined ? null : id(value);
}
function tags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100)
    fail("タグは 100 個以内の配列で指定してください。");
  return [...new Set((value as unknown[]).map((tag) => str(tag, "タグ", 100)))];
}
function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500)
    fail("ブロック ID を 1〜500 個指定してください。");
  const result = (value as unknown[]).map((entry) => id(entry));
  if (new Set(result).size !== result.length)
    fail("同じブロック ID が重複しています。");
  return result;
}
function index(value: unknown, length: number): number {
  if (value === undefined) return length;
  if (
    !Number.isInteger(value) ||
    (value as number) < 0 ||
    (value as number) > length
  )
    fail("挿入位置が範囲外です。");
  return value as number;
}
function blockInput(value: unknown): Block {
  const data = object(value);
  keys(data, ["id", "type", "html", "src", "name", "width", "caption"]);
  if (!TYPES.includes(data.type as BlockType))
    fail("未対応のブロック種類です。");
  const block: Block = {
    id: data.id === undefined ? uid() : id(data.id),
    type: data.type as BlockType,
  };
  if (data.html !== undefined) {
    if (typeof data.html !== "string" || data.html.length > 1_000_000)
      fail("HTML は 100 万文字以内で指定してください。");
    block.html =
      block.type === "code" || block.type === "math"
        ? (data.html as string)
        : sanitizeHtml(data.html as string);
  }
  if (data.src !== undefined) {
    if (
      typeof data.src !== "string" ||
      data.src.length > 12_000_000 ||
      !isSafeImageUrl(data.src) ||
      !/^(https:|data:)/i.test(data.src)
    )
      fail("画像は HTTPS URL または対応する画像データで指定してください。");
    block.src = data.src as string;
  }
  if (block.type === "image" && !block.src)
    fail("画像ブロックには src が必要です。");
  if (data.name !== undefined) block.name = str(data.name, "画像名", 500);
  if (data.caption !== undefined)
    block.caption = str(data.caption, "キャプション", 2000);
  if (data.width !== undefined) {
    if (typeof data.width !== "number" || data.width < 10 || data.width > 100)
      fail("画像の幅は 10〜100 % で指定してください。");
    block.width = data.width as number;
  }
  return block;
}
function blocks(value: unknown): Block[] {
  if (!Array.isArray(value) || value.length > 500)
    fail("ブロックは 500 個以内の配列で指定してください。");
  const result = (value as unknown[]).map(blockInput);
  if (new Set(result.map((block) => block.id)).size !== result.length)
    fail("ブロック ID が重複しています。");
  return result;
}

/** All writes happen on a private copy. Call snapshot() only after the complete batch succeeds. */
export class WorkspaceApi {
  private data: Workspace;
  private baseline = new Map<string, string>();
  private touched = new Set<string>();
  readonly summary: string[] = [];

  constructor(workspace: Workspace) {
    this.data = clone(workspace);
    workspace.notes.forEach((note) =>
      this.baseline.set(note.id, note.updatedAt),
    );
  }
  snapshot(): Workspace {
    return clone(this.data);
  }
  listFolders(): Folder[] {
    return clone(this.data.folders);
  }
  listNotes(folderId?: string | null): Note[] {
    return clone(
      this.data.notes.filter(
        (note) =>
          !note.deletedAt &&
          (folderId === undefined || note.folderId === folderId),
      ),
    );
  }
  getNote(noteId: string): Note {
    return clone(this.note(noteId));
  }
  private folder(folderId: string | null) {
    if (
      folderId !== null &&
      !this.data.folders.some((folder) => folder.id === folderId)
    )
      fail("指定されたフォルダが見つかりません。");
  }
  private note(noteId: string): Note {
    const note = this.data.notes.find(
      (item) => item.id === noteId && !item.deletedAt,
    );
    return (
      note ||
      fail(
        "指定されたノートが見つかりません（ゴミ箱内のノートは変更できません）。",
      )
    );
  }
  private change(noteId: string, expected: unknown): Note {
    const note = this.note(id(noteId));
    if (str(expected, "更新日時", 100) !== this.baseline.get(noteId))
      fail(
        `「${note.title}」が更新されています。現在の更新日時で提案を作り直してください。`,
      );
    if (!this.touched.has(note.id)) {
      note.revisions = [
        ...note.revisions,
        {
          id: uid(),
          at: note.updatedAt,
          title: note.title,
          blocks: clone(note.blocks),
        },
      ].slice(-50);
      this.touched.add(note.id);
    }
    // Never reuse the previous token even when two edits happen in the same millisecond.
    note.updatedAt = new Date(
      Math.max(Date.now(), new Date(note.updatedAt).getTime() + 1),
    ).toISOString();
    return note;
  }
  private uniqueBlocks(
    note: Note,
    additions: Block[],
    exceptIds: string[] = [],
  ) {
    const existing = new Set(
      note.blocks
        .filter((block) => !exceptIds.includes(block.id))
        .map((block) => block.id),
    );
    if (additions.some((block) => existing.has(block.id)))
      fail("追加先に同じブロック ID が存在します。");
  }
  createFolder(input: {
    id?: string;
    name: string;
    parentId?: string | null;
  }): Folder {
    const folder: Folder = {
      id: input.id === undefined ? uid() : id(input.id),
      name: str(input.name, "フォルダ名", 200),
      parentId: nullableId(input.parentId),
      order: this.data.folders.length,
    };
    this.folder(folder.parentId);
    if (this.data.folders.some((item) => item.id === folder.id))
      fail("フォルダ ID が重複しています。");
    this.data.folders.push(folder);
    this.summary.push(`フォルダ「${folder.name}」を作成`);
    return clone(folder);
  }
  createNote(input: {
    id?: string;
    title: string;
    folderId?: string | null;
    tags?: string[];
    blocks?: BlockInput[];
  }): Note {
    const folderId = nullableId(input.folderId);
    this.folder(folderId);
    const now = new Date().toISOString();
    const note: Note = {
      id: input.id === undefined ? uid() : id(input.id),
      title: str(input.title, "タイトル", 500),
      folderId,
      tags: input.tags === undefined ? [] : tags(input.tags),
      favorite: false,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      order: this.data.notes.length,
      blocks: input.blocks === undefined ? [] : blocks(input.blocks),
      originals: [],
      revisions: [],
    };
    if (this.data.notes.some((item) => item.id === note.id))
      fail("ノート ID が重複しています。");
    this.data.notes.push(note);
    this.baseline.set(note.id, now);
    this.summary.push(
      `ノート「${note.title}」を作成（${note.blocks.length} ブロック）`,
    );
    return clone(note);
  }
  editNote(
    noteId: string,
    expectedUpdatedAt: string,
    patch: {
      title?: string;
      tags?: string[];
      favorite?: boolean;
      pinned?: boolean;
      sourceUrl?: string;
    },
  ): Note {
    keys(object(patch), ["title", "tags", "favorite", "pinned", "sourceUrl"]);
    if (!Object.keys(patch).length) fail("変更する項目を指定してください。");
    const validated: Partial<Note> = {};
    if (patch.title !== undefined)
      validated.title = str(patch.title, "タイトル", 500);
    if (patch.tags !== undefined) validated.tags = tags(patch.tags);
    for (const key of ["favorite", "pinned"] as const) {
      if (patch[key] !== undefined) {
        if (typeof patch[key] !== "boolean")
          fail(`${key} は true / false で指定してください。`);
        validated[key] = patch[key];
      }
    }
    if (patch.sourceUrl !== undefined) {
      if (
        typeof patch.sourceUrl !== "string" ||
        !/^https?:\/\//i.test(patch.sourceUrl) ||
        patch.sourceUrl.length > 4000
      )
        fail("元 URL は HTTP / HTTPS で指定してください。");
      validated.sourceUrl = patch.sourceUrl;
    }
    const note = this.change(noteId, expectedUpdatedAt);
    Object.assign(note, validated);
    this.summary.push(
      `「${note.title}」の ${Object.keys(patch).join("・")} を変更`,
    );
    return clone(note);
  }
  appendNote(
    noteId: string,
    expectedUpdatedAt: string,
    input: BlockInput[],
  ): Note {
    return this.addBlocks(noteId, expectedUpdatedAt, input);
  }
  moveNote(
    noteId: string,
    expectedUpdatedAt: string,
    folderId: string | null,
  ): Note {
    this.folder(nullableId(folderId));
    const note = this.change(noteId, expectedUpdatedAt);
    note.folderId = folderId;
    this.summary.push(
      `「${note.title}」を ${this.data.folders.find((folder) => folder.id === folderId)?.name || "すべてのノート直下"} へ移動`,
    );
    return clone(note);
  }
  addBlocks(
    noteId: string,
    expectedUpdatedAt: string,
    input: BlockInput[],
    at?: number,
  ): Note {
    const additions = blocks(input);
    const before = this.note(noteId);
    this.uniqueBlocks(before, additions);
    const position = index(at, before.blocks.length);
    const note = this.change(noteId, expectedUpdatedAt);
    note.blocks.splice(position, 0, ...additions);
    this.summary.push(`「${note.title}」に ${additions.length} ブロックを追加`);
    return clone(note);
  }
  editBlocks(
    noteId: string,
    expectedUpdatedAt: string,
    edits: { blockId: string; block: BlockInput }[],
  ): Note {
    const nextBlocks = clone(this.note(noteId).blocks);
    if (!Array.isArray(edits) || edits.length > 500)
      fail("ブロック編集は 500 件以内で指定してください。");
    for (const edit of edits) {
      const blockId = id(edit.blockId);
      const position = nextBlocks.findIndex((block) => block.id === blockId);
      if (position < 0) fail("編集するブロックが見つかりません。");
      const replacement = blockInput({ ...edit.block, id: blockId });
      nextBlocks[position] = replacement;
    }
    const note = this.change(noteId, expectedUpdatedAt);
    note.blocks = nextBlocks;
    this.summary.push(`「${note.title}」の ${edits.length} ブロックを編集`);
    return clone(note);
  }
  moveBlocks(
    noteId: string,
    expectedUpdatedAt: string,
    blockIds: string[],
    toNoteId: string,
    toExpectedUpdatedAt: string,
    at?: number,
  ): void {
    const selected = ids(blockIds);
    const beforeSource = this.note(noteId),
      beforeDestination = this.note(toNoteId);
    if (
      selected.some(
        (blockId) => !beforeSource.blocks.some((block) => block.id === blockId),
      )
    )
      fail("移動するブロックが見つかりません。");
    const moving = beforeSource.blocks.filter((block) =>
      selected.includes(block.id),
    );
    if (beforeSource.id !== beforeDestination.id)
      this.uniqueBlocks(beforeDestination, moving);
    const position = index(
      at,
      beforeDestination.blocks.length -
        (noteId === toNoteId ? moving.length : 0),
    );
    // Validate both tokens before touching either source or destination.
    if (
      expectedUpdatedAt !== this.baseline.get(noteId) ||
      toExpectedUpdatedAt !== this.baseline.get(toNoteId)
    )
      fail(
        "ノートが更新されています。現在の更新日時で提案を作り直してください。",
      );
    const source = this.change(noteId, expectedUpdatedAt),
      destination = this.change(toNoteId, toExpectedUpdatedAt);
    source.blocks = source.blocks.filter(
      (block) => !selected.includes(block.id),
    );
    destination.blocks.splice(position, 0, ...moving);
    this.summary.push(
      `「${source.title}」の ${moving.length} ブロックを「${destination.title}」へ移動`,
    );
  }
  /** If a batch fails, this instance is rolled back as well as leaving its caller untouched. */
  batch(operations: ProposalOperation[]): ProposalPreview {
    const before = this.snapshot(),
      summaryBefore = [...this.summary],
      touchedBefore = new Set(this.touched),
      baselineBefore = new Map(this.baseline);
    try {
      if (
        !Array.isArray(operations) ||
        operations.length === 0 ||
        operations.length > 1000
      )
        fail("操作は 1〜1000 件で指定してください。");
      for (const operation of operations) this.execute(operation);
      return { summary: [...this.summary], next: this.snapshot() };
    } catch (error) {
      this.data = before;
      this.summary.splice(0, this.summary.length, ...summaryBefore);
      this.touched = touchedBefore;
      this.baseline = baselineBefore;
      throw error;
    }
  }
  private execute(raw: ProposalOperation) {
    const data = object(raw);
    const base = ["op", "noteId", "expectedUpdatedAt"];
    switch (data.op) {
      case "create_folder":
        keys(data, ["op", "id", "name", "parentId"]);
        this.createFolder(
          data as unknown as Extract<
            ProposalOperation,
            { op: "create_folder" }
          >,
        );
        break;
      case "create_note":
        keys(data, ["op", "id", "title", "folderId", "tags", "blocks"]);
        this.createNote(
          data as unknown as Extract<ProposalOperation, { op: "create_note" }>,
        );
        break;
      case "rename_folder": {
        keys(data, ["op", "folderId", "name"]);
        const folder =
          this.data.folders.find((item) => item.id === id(data.folderId)) ||
          fail("フォルダが見つかりません。");
        folder.name = str(data.name, "フォルダ名", 200);
        this.summary.push(`フォルダ名を「${folder.name}」に変更`);
        break;
      }
      case "move_folder": {
        keys(data, ["op", "folderId", "parentId"]);
        if (!Object.hasOwn(data, "parentId"))
          fail("移動先の parentId を指定してください。最上位は null です。");
        const folder =
          this.data.folders.find((item) => item.id === id(data.folderId)) ||
          fail("フォルダが見つかりません。");
        const parentId = nullableId(data.parentId);
        this.folder(parentId);
        let cursor = parentId;
        const visited = new Set<string>();
        while (cursor) {
          if (cursor === folder.id || visited.has(cursor))
            fail("フォルダを自分自身や子フォルダの下へ移動できません。");
          visited.add(cursor);
          cursor =
            this.data.folders.find((item) => item.id === cursor)?.parentId ||
            null;
        }
        folder.parentId = parentId;
        this.summary.push(`フォルダ「${folder.name}」を移動`);
        break;
      }
      case "edit_note": {
        keys(data, [
          ...base,
          "title",
          "tags",
          "favorite",
          "pinned",
          "sourceUrl",
        ]);
        const { op: _op, noteId, expectedUpdatedAt, ...patch } = data;
        this.editNote(
          id(noteId),
          str(expectedUpdatedAt, "更新日時", 100),
          patch,
        );
        break;
      }
      case "append_note":
      case "add_blocks":
        keys(data, [
          ...base,
          "blocks",
          ...(data.op === "add_blocks" ? ["index"] : []),
        ]);
        this.addBlocks(
          id(data.noteId),
          str(data.expectedUpdatedAt, "更新日時", 100),
          data.blocks as BlockInput[],
          data.index as number | undefined,
        );
        break;
      case "move_note":
        keys(data, [...base, "folderId"]);
        if (!Object.hasOwn(data, "folderId"))
          fail("移動先の folderId を指定してください。最上位は null です。");
        this.moveNote(
          id(data.noteId),
          str(data.expectedUpdatedAt, "更新日時", 100),
          nullableId(data.folderId),
        );
        break;
      case "edit_block":
        keys(data, [...base, "blockId", "block"]);
        this.editBlocks(
          id(data.noteId),
          str(data.expectedUpdatedAt, "更新日時", 100),
          [{ blockId: id(data.blockId), block: data.block as BlockInput }],
        );
        break;
      case "delete_blocks": {
        keys(data, [...base, "blockIds"]);
        const selected = ids(data.blockIds);
        const before = this.note(id(data.noteId));
        if (
          selected.some(
            (blockId) => !before.blocks.some((block) => block.id === blockId),
          )
        )
          fail("削除するブロックが見つかりません。");
        const note = this.change(id(data.noteId), data.expectedUpdatedAt);
        note.blocks = note.blocks.filter(
          (block) => !selected.includes(block.id),
        );
        this.summary.push(
          `「${note.title}」の ${selected.length} ブロックを削除`,
        );
        break;
      }
      case "move_blocks":
        keys(data, [
          ...base,
          "blockIds",
          "toNoteId",
          "toExpectedUpdatedAt",
          "index",
        ]);
        this.moveBlocks(
          id(data.noteId),
          str(data.expectedUpdatedAt, "更新日時", 100),
          ids(data.blockIds),
          id(data.toNoteId),
          str(data.toExpectedUpdatedAt, "移動先の更新日時", 100),
          data.index as number | undefined,
        );
        break;
      case "trash_note": {
        keys(data, base);
        const note = this.change(id(data.noteId), data.expectedUpdatedAt);
        note.deletedAt = note.updatedAt;
        this.summary.push(`「${note.title}」をゴミ箱へ移動`);
        break;
      }
      default:
        fail(`未対応の操作です: ${String(data.op)}`);
    }
  }
}

/** Strict JSON only; prose and code fences are intentionally rejected to avoid ambiguous writes. */
export function parseProposal(
  text: string,
  workspace: Workspace,
): ProposalPreview {
  if (text.length > 16_000_000)
    fail("提案が大きすぎます。画像を減らして分割してください。");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail(
      "JSON の形式を確認してください。コードフェンスや説明文は取り除いてください。",
    );
  }
  const proposal = object(parsed);
  keys(proposal, ["version", "operations"]);
  if (proposal.version !== 1) fail("提案の version は 1 を指定してください。");
  return new WorkspaceApi(workspace).batch(
    proposal.operations as ProposalOperation[],
  );
}

export const validateProposal = parseProposal;
