import { describe, expect, it } from "vitest";
import { parseProposal, WorkspaceApi } from "../src/core/ai";
import type { Workspace } from "../src/core/types";

const stamp = "2026-10-22T00:00:00.000Z";
const makeWorkspace = (): Workspace => ({
  schemaVersion: 1,
  folders: [
    { id: "folder", name: "歴史", parentId: null, order: 0 },
    { id: "child", name: "日本史", parentId: "folder", order: 1 },
  ],
  notes: [
    {
      id: "a",
      title: "日本史",
      folderId: "folder",
      tags: [],
      favorite: false,
      pinned: false,
      createdAt: stamp,
      updatedAt: stamp,
      deletedAt: null,
      order: 0,
      blocks: [
        { id: "p", type: "text", html: "<p>原本の本文</p>" },
        { id: "q", type: "table", html: "<table><tr><td>年</td></tr></table>" },
      ],
      originals: [{ kind: "text", content: "元の内容", capturedAt: stamp }],
      revisions: [],
    },
    {
      id: "b",
      title: "まとめ",
      folderId: null,
      tags: [],
      favorite: false,
      pinned: false,
      createdAt: stamp,
      updatedAt: stamp,
      deletedAt: null,
      order: 1,
      blocks: [],
      originals: [],
      revisions: [],
    },
  ],
});
const proposal = (operations: unknown[]) =>
  JSON.stringify({ version: 1, operations });
const expected = { noteId: "a", expectedUpdatedAt: stamp };

describe("local AI proposal transaction API", () => {
  it("retains code and math source exactly rather than parsing them as HTML", () => {
    const code = '<script>example()</script>\nif (a < b) return "<div>";';
    const math = "a < b \\implies x^2 > 0";
    const result = parseProposal(
      proposal([
        {
          op: "append_note",
          ...expected,
          blocks: [
            { type: "code", html: code },
            { type: "math", html: math },
          ],
        },
      ]),
      makeWorkspace(),
    );
    expect(result.next.notes[0].blocks.at(-2)?.html).toBe(code);
    expect(result.next.notes[0].blocks.at(-1)?.html).toBe(math);
  });
  it("requires an explicit move destination and a nonempty edit", () => {
    for (const operation of [
      { op: "move_note", ...expected },
      { op: "move_folder", folderId: "child" },
      { op: "edit_note", ...expected },
    ]) {
      expect(() =>
        parseProposal(proposal([operation]), makeWorkspace()),
      ).toThrow("指定してください");
    }
  });
  it("creates folder and note, preserving the original workspace", () => {
    const workspace = makeWorkspace();
    const preview = parseProposal(
      proposal([
        { op: "create_folder", id: "science", name: "科学" },
        {
          op: "create_note",
          title: "光の性質",
          folderId: "science",
          blocks: [{ type: "heading", html: "<h2>光</h2>" }],
        },
      ]),
      workspace,
    );
    expect(workspace.notes).toHaveLength(2);
    expect(preview.next.notes).toHaveLength(3);
    expect(preview.next.notes[2].folderId).toBe("science");
    expect(preview.summary).toHaveLength(2);
  });
  it("rejects stale edits rather than overwriting newer changes", () => {
    expect(() =>
      parseProposal(
        proposal([
          {
            op: "edit_note",
            ...expected,
            expectedUpdatedAt: "old",
            title: "上書き",
          },
        ]),
        makeWorkspace(),
      ),
    ).toThrow("更新されています");
  });
  it("requires a concurrency token on all existing note mutations", () => {
    expect(() =>
      parseProposal(
        proposal([{ op: "move_note", noteId: "a", folderId: null }]),
        makeWorkspace(),
      ),
    ).toThrow("更新日時");
  });
  it("supports multiple operations against one baseline token, recording one revision", () => {
    const result = parseProposal(
      proposal([
        {
          op: "edit_note",
          ...expected,
          title: "日本史の年表",
          tags: ["歴史", "歴史"],
        },
        {
          op: "append_note",
          ...expected,
          blocks: [{ type: "text", html: "<p>追記</p>" }],
        },
      ]),
      makeWorkspace(),
    );
    expect(result.next.notes[0].title).toBe("日本史の年表");
    expect(result.next.notes[0].tags).toEqual(["歴史"]);
    expect(result.next.notes[0].blocks).toHaveLength(3);
    expect(result.next.notes[0].revisions).toHaveLength(1);
    expect(result.next.notes[0].revisions[0].title).toBe("日本史");
    expect(result.next.notes[0].originals[0].content).toBe("元の内容");
    expect(result.next.notes[0].updatedAt).not.toBe(stamp);
  });
  it("rolls a batch back entirely if a later operation fails", () => {
    const workspace = makeWorkspace();
    const api = new WorkspaceApi(workspace);
    expect(() =>
      api.batch([
        { op: "edit_note", ...expected, title: "変更" },
        { op: "move_note", ...expected, folderId: "missing" },
      ]),
    ).toThrow();
    expect(api.snapshot()).toEqual(workspace);
    expect(api.summary).toEqual([]);
  });
  it("sanitizes HTML while keeping editable tables", () => {
    const result = parseProposal(
      proposal([
        {
          op: "edit_block",
          ...expected,
          blockId: "q",
          block: {
            type: "table",
            html: '<table onclick="alert(1)"><tr><td>変更</td></tr></table><script>alert(1)</script><img src="x" onerror="alert(1)"><p style="background-image:url(https://example.com/track)">本文</p>',
          },
        },
      ]),
      makeWorkspace(),
    );
    const html = result.next.notes[0].blocks[1].html!;
    expect(html).toContain("<table>");
    expect(html).toContain("変更");
    expect(html).not.toMatch(/script|onclick|onerror|background-image/);
  });
  it("moves blocks across notes without losing identity or mutating originals", () => {
    const result = parseProposal(
      proposal([
        {
          op: "move_blocks",
          ...expected,
          blockIds: ["q", "p"],
          toNoteId: "b",
          toExpectedUpdatedAt: stamp,
        },
      ]),
      makeWorkspace(),
    );
    expect(result.next.notes[0].blocks).toEqual([]);
    expect(result.next.notes[1].blocks.map((block) => block.id)).toEqual([
      "p",
      "q",
    ]);
    expect(result.next.notes[0].originals).toHaveLength(1);
    expect(result.next.notes[0].revisions).toHaveLength(1);
    expect(result.next.notes[1].revisions).toHaveLength(1);
  });
  it("reorders a group of blocks within the same note", () => {
    const result = parseProposal(
      proposal([
        {
          op: "move_blocks",
          ...expected,
          blockIds: ["q"],
          toNoteId: "a",
          toExpectedUpdatedAt: stamp,
          index: 0,
        },
      ]),
      makeWorkspace(),
    );
    expect(result.next.notes[0].blocks.map((block) => block.id)).toEqual([
      "q",
      "p",
    ]);
  });
  it("rejects a stale destination token too", () => {
    expect(() =>
      parseProposal(
        proposal([
          {
            op: "move_blocks",
            ...expected,
            blockIds: ["p"],
            toNoteId: "b",
            toExpectedUpdatedAt: "stale",
          },
        ]),
        makeWorkspace(),
      ),
    ).toThrow("更新されています");
  });
  it("rejects cycles in folder hierarchy", () => {
    expect(() =>
      parseProposal(
        proposal([
          { op: "move_folder", folderId: "folder", parentId: "child" },
        ]),
        makeWorkspace(),
      ),
    ).toThrow("子フォルダ");
  });
  it("rejects missing blocks instead of silently deleting nothing", () => {
    expect(() =>
      parseProposal(
        proposal([{ op: "delete_blocks", ...expected, blockIds: ["missing"] }]),
        makeWorkspace(),
      ),
    ).toThrow("見つかりません");
  });
  it("rejects duplicate block IDs and unsupported payload fields", () => {
    expect(() =>
      parseProposal(
        proposal([
          {
            op: "add_blocks",
            ...expected,
            blocks: [{ id: "p", type: "text", html: "x" }],
          },
        ]),
        makeWorkspace(),
      ),
    ).toThrow("同じブロック ID");
    expect(() =>
      parseProposal(
        proposal([
          { op: "edit_note", ...expected, __proto: "invalid", title: "x" },
        ]),
        makeWorkspace(),
      ),
    ).toThrow("未対応の項目");
  });
  it("rejects executable image schemes and unknown operations", () => {
    expect(() =>
      parseProposal(
        proposal([
          {
            op: "add_blocks",
            ...expected,
            blocks: [{ type: "image", src: "javascript:alert(1)" }],
          },
        ]),
        makeWorkspace(),
      ),
    ).toThrow("画像");
    expect(() =>
      parseProposal(
        proposal([{ op: "run_code", code: "alert(1)" }]),
        makeWorkspace(),
      ),
    ).toThrow("未対応の操作");
  });
  it("returns detached snapshots and read results", () => {
    const api = new WorkspaceApi(makeWorkspace());
    const note = api.getNote("a");
    note.title = "別の値";
    const snapshot = api.snapshot();
    snapshot.notes[0].blocks = [];
    expect(api.getNote("a").title).toBe("日本史");
    expect(api.getNote("a").blocks).toHaveLength(2);
  });
  it("keeps trashed notes unavailable through the editing API", () => {
    const result = parseProposal(
      proposal([{ op: "trash_note", ...expected }]),
      makeWorkspace(),
    );
    const api = new WorkspaceApi(result.next);
    expect(api.listNotes()).toHaveLength(1);
    expect(() => api.getNote("a")).toThrow("ゴミ箱");
  });
  it("rejects invalid JSON, unsupported versions and empty proposals", () => {
    for (const input of [
      "```json\n{}\n```",
      "{}",
      '{"version":2,"operations":[]}',
      proposal([]),
    ]) {
      expect(() => parseProposal(input, makeWorkspace())).toThrow();
    }
  });
});
