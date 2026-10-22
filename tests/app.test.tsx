import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import App from "../src/App";
import {
  closeStorage,
  DATABASE_NAME,
  loadWorkspace,
} from "../src/core/storage";
import { createBackupText, downloadBackup } from "../src/core/import";

vi.mock("../src/core/import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/import")>();
  return { ...actual, downloadBackup: vi.fn().mockResolvedValue(undefined) };
});

async function stored() {
  return (await loadWorkspace()).workspace!;
}
async function openApp() {
  const view = render(<App />);
  await screen.findByRole("textbox", { name: "ノートのタイトル" });
  return view;
}
async function persistTitle(title: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "ノートのタイトル" }), {
    target: { value: title },
  });
  await waitFor(
    async () =>
      expect((await stored()).notes.some((note) => note.title === title)).toBe(
        true,
      ),
    { timeout: 3000 },
  );
}
beforeEach(async () => {
  await closeStorage();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  vi.clearAllMocks();
});
afterEach(async () => {
  cleanup();
  await closeStorage();
});

describe("Folio application workflows", () => {
  it("renames the currently selected top-level folder without making it its own parent", async () => {
    await openApp();
    fireEvent.click(screen.getByRole("button", { name: "日本史1" }));
    fireEvent.click(screen.getByRole("button", { name: "日本史を編集" }));
    const dialog = screen.getByRole("dialog", { name: "フォルダを編集" });
    expect(
      (within(dialog).getByLabelText("保存先") as HTMLSelectElement).value,
    ).toBe("");
    fireEvent.change(within(dialog).getByLabelText("フォルダ名"), {
      target: { value: "日本史を学ぶ" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存する" }));
    await waitFor(
      async () => {
        const folder = (await stored()).folders.find(
          (folder) => folder.id === "folder-history",
        );
        expect(folder?.name).toBe("日本史を学ぶ");
        expect(folder?.parentId).toBeNull();
      },
      { timeout: 3000 },
    );
  });
  it("creates and edits a Japanese note, autosaves, and reloads it after remount", async () => {
    const view = await openApp();
    fireEvent.click(screen.getAllByRole("button", { name: "ノートを作成" })[0]);
    fireEvent.change(
      screen.getByRole("textbox", { name: "ノートのタイトル" }),
      { target: { value: "毎日の日本語メモ" } },
    );
    const editor = screen.getByRole("textbox", { name: "テキストを編集" });
    editor.innerHTML = "<p>学んだことを自分の言葉で記録します。</p>";
    fireEvent.input(editor);
    await waitFor(
      async () => {
        const note = (await stored()).notes.find(
          (note) => note.title === "毎日の日本語メモ",
        );
        expect(note?.blocks[0].html).toContain("自分の言葉");
      },
      { timeout: 3000 },
    );
    view.unmount();
    await closeStorage();
    await openApp();
    expect(
      (
        screen.getByRole("textbox", {
          name: "ノートのタイトル",
        }) as HTMLInputElement
      ).value,
    ).toBe("毎日の日本語メモ");
    expect(
      screen.getByRole("textbox", { name: "テキストを編集" }).textContent,
    ).toContain("自分の言葉");
  });

  it("creates a folder, creates a note within it, then trashes and restores that note", async () => {
    await openApp();
    fireEvent.click(screen.getByRole("button", { name: "フォルダを追加" }));
    const dialog = screen.getByRole("dialog", { name: "新しいフォルダ" });
    fireEvent.change(within(dialog).getByLabelText("フォルダ名"), {
      target: { value: "検証資料" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存する" }));
    fireEvent.click(screen.getByText("検証資料").closest("button")!);
    fireEvent.click(screen.getAllByRole("button", { name: "ノートを作成" })[0]);
    await persistTitle("フォルダの記録");
    const data = await stored(),
      folder = data.folders.find((folder) => folder.name === "検証資料")!;
    expect(
      data.notes.find((note) => note.title === "フォルダの記録")?.folderId,
    ).toBe(folder.id);
    fireEvent.click(screen.getByRole("button", { name: "ノートの操作" }));
    fireEvent.click(screen.getByRole("button", { name: "ゴミ箱へ移動" }));
    await waitFor(
      async () =>
        expect(
          (await stored()).notes.find((note) => note.title === "フォルダの記録")
            ?.deletedAt,
        ).toBeTruthy(),
      { timeout: 3000 },
    );
    fireEvent.click(screen.getByRole("button", { name: "復元する" }));
    await waitFor(
      async () =>
        expect(
          (await stored()).notes.find((note) => note.title === "フォルダの記録")
            ?.deletedAt,
        ).toBeNull(),
      { timeout: 3000 },
    );
    expect(
      (await stored()).notes.find((note) => note.title === "フォルダの記録")
        ?.folderId,
    ).toBe(folder.id);
  });

  it("imports rich HTML through paste, preserving an original separately from editable blocks", async () => {
    await openApp();
    fireEvent.click(
      screen.getByRole("button", {
        name: /^回答を取り込む/,
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "回答を取り込む" });
    const html = readFileSync(
      resolve("public/examples/rich-answer.html"),
      "utf8",
    );
    fireEvent.paste(
      within(dialog).getByRole("textbox", { name: "取り込む回答" }),
      {
        clipboardData: {
          files: [],
          getData: (type: string) => (type === "text/html" ? html : ""),
        },
      },
    );
    expect(
      (
        within(dialog).getByRole("combobox", {
          name: "取り込み形式",
        }) as HTMLSelectElement
      ).value,
    ).toBe("html");
    fireEvent.change(within(dialog).getByLabelText("ノートのタイトル"), {
      target: { value: "豊かな回答の保存" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "取り込む" }));
    await waitFor(
      async () => {
        const note = (await stored()).notes.find(
          (note) => note.title === "豊かな回答の保存",
        );
        expect(note?.originals[0].content).toBe(html);
        expect(
          note?.blocks.some((block) => block.html?.includes("<table")),
        ).toBe(true);
        expect(note?.blocks.some((block) => block.html?.includes("<svg"))).toBe(
          true,
        );
        expect(
          note?.blocks.some((block) =>
            block.html?.includes("data:image/png;base64,"),
          ),
        ).toBe(true);
      },
      { timeout: 3000 },
    );
  });

  it("previews AI changes without writing, then applies the reviewed transaction with a backup", async () => {
    await openApp();
    const count = (await stored()).notes.length;
    fireEvent.click(screen.getByRole("button", { name: "設定とバックアップ" }));
    fireEvent.click(screen.getByRole("button", { name: "変更提案を開く" }));
    const dialog = screen.getByRole("dialog", { name: "AIの変更提案を確認" });
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "AI変更提案JSON" }),
      {
        target: {
          value: JSON.stringify({
            version: 1,
            operations: [
              {
                op: "create_note",
                title: "確認済みの提案",
                blocks: [{ type: "text", html: "<p>保存する内容</p>" }],
              },
            ],
          }),
        },
      },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "変更をプレビュー" }),
    );
    expect((await stored()).notes).toHaveLength(count);
    expect(
      within(dialog).getByText(/ノート「確認済みの提案」を作成/),
    ).toBeTruthy();
    expect(within(dialog).getByLabelText("変更後").textContent).toContain(
      "保存する内容",
    );
    expect(within(dialog).getByLabelText("変更前").textContent).toContain(
      "存在しません",
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "確認した変更を適用" }),
    );
    await waitFor(
      async () => expect((await stored()).notes).toHaveLength(count + 1),
      { timeout: 3000 },
    );
    expect(downloadBackup).toHaveBeenCalledTimes(1);
    expect(
      (await stored()).notes.find((note) => note.title === "確認済みの提案")
        ?.blocks[0].html,
    ).toContain("保存する内容");
  });

  it("validates a backup before restore and preserves current notes if the safety backup fails", async () => {
    await openApp();
    const current = await stored();
    const incoming = structuredClone(current);
    incoming.notes[0].title = "バックアップから戻したノート";
    const text = await createBackupText(incoming);
    const file = new File([text], "restore.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => text });
    fireEvent.click(screen.getByRole("button", { name: "設定とバックアップ" }));
    const dialog = screen.getByRole("dialog", { name: "設定とバックアップ" });
    fireEvent.change(within(dialog).getByLabelText("バックアップを選ぶ"), {
      target: { files: [file] },
    });
    const apply = await within(dialog).findByRole("button", {
      name: "この内容で復元する",
    });
    vi.mocked(downloadBackup).mockRejectedValueOnce(
      new Error("安全なバックアップを保存できません"),
    );
    fireEvent.click(apply);
    await screen.findByText(
      "復元に失敗しました：安全なバックアップを保存できません",
    );
    expect((await stored()).notes[0].title).toBe(current.notes[0].title);
    fireEvent.click(apply);
    await waitFor(
      async () =>
        expect((await stored()).notes[0].title).toBe(
          "バックアップから戻したノート",
        ),
      { timeout: 3000 },
    );
    expect(downloadBackup).toHaveBeenCalledTimes(2);
  });
});
