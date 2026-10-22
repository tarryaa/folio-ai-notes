import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Editor, { ImageLightbox } from "../src/components/Editor";
import type { Block, Note, Original } from "../src/core/types";
import {
  blocksToHtml,
  blocksToText,
  createBackupText,
  parseBackup,
} from "../src/core/import";

function note(blocks: Block[], id = "note-one"): Note {
  return {
    id,
    title: "テスト",
    blocks,
    originals: [],
    folderId: null,
    tags: [],
    favorite: false,
    pinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    order: 0,
    revisions: [],
  };
}
function Harness({
  initial,
  capture = () => {},
  notify = () => {},
  changed = () => {},
}: {
  initial: Note;
  capture?: (items: Original[]) => void;
  notify?: (message: string) => void;
  changed?: (blocks: Block[]) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <Editor
        note={value}
        onChange={(blocks) => {
          setValue((previous) => ({ ...previous, blocks }));
          changed(blocks);
        }}
        onNotify={notify}
        onCaptureOriginals={capture}
      />
      <output data-testid="blocks">{JSON.stringify(value.blocks)}</output>
    </>
  );
}
const latestBlocks = (): Block[] =>
  JSON.parse(screen.getByTestId("blocks").textContent || "[]");

describe("block editor", () => {
  it("coalesces Japanese typing into an undo step and supports redo without overwriting caret DOM", () => {
    render(
      <Harness
        initial={note([{ id: "a", type: "text", html: "<p>最初</p>" }])}
      />,
    );
    const editable = screen.getByRole("textbox", { name: "テキストを編集" });
    editable.focus();
    editable.innerHTML = "<p>日本</p>";
    fireEvent.input(editable);
    editable.innerHTML = "<p>日本語の文章</p>";
    fireEvent.input(editable);
    expect(latestBlocks()[0].html).toBe("<p>日本語の文章</p>");
    expect(editable.innerHTML).toBe("<p>日本語の文章</p>");
    fireEvent.click(screen.getByRole("button", { name: "元に戻す (Ctrl+Z)" }));
    expect(latestBlocks()[0].html).toBe("<p>最初</p>");
    expect(editable.innerHTML).toBe("<p>最初</p>");
    expect(editable.contains(window.getSelection()?.anchorNode || null)).toBe(
      true,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "やり直す (Ctrl+Shift+Z)" }),
    );
    expect(latestBlocks()[0].html).toBe("<p>日本語の文章</p>");
  });

  it("does not save incomplete IME composition or intercept composing undo keys", () => {
    const changed = vi.fn();
    render(
      <Harness
        initial={note([{ id: "a", type: "text", html: "<p>開始</p>" }])}
        changed={changed}
      />,
    );
    const editable = screen.getByRole("textbox", { name: "テキストを編集" });
    fireEvent.compositionStart(editable);
    editable.innerHTML = "<p>にほん</p>";
    fireEvent.input(editable);
    expect(changed).not.toHaveBeenCalled();
    fireEvent.keyDown(editable, { key: "z", ctrlKey: true, isComposing: true });
    expect(editable.innerHTML).toBe("<p>にほん</p>");
    editable.innerHTML = "<p>日本</p>";
    fireEvent.compositionEnd(editable);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(latestBlocks()[0].html).toBe("<p>日本</p>");
  });

  it("reorders multiple selected blocks together and restores a bulk deletion with undo", () => {
    const initial = note(
      ["a", "b", "c"].map((id) => ({ id, type: "text", html: `<p>${id}</p>` })),
    );
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "ブロックを選択" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "1番目のブロックを選択" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "2番目のブロックを選択" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "選択を下へ移動" }));
    expect(latestBlocks().map((block) => block.id)).toEqual(["c", "a", "b"]);
    fireEvent.click(screen.getByRole("button", { name: "選択を削除" }));
    expect(latestBlocks().map((block) => block.id)).toEqual(["c"]);
    fireEvent.click(screen.getByRole("button", { name: "元に戻す (Ctrl+Z)" }));
    expect(latestBlocks().map((block) => block.id)).toEqual(["c", "a", "b"]);
  });

  it("preserves image source pixels while width and overlay annotations are changed and reset", () => {
    const source = "data:image/png;base64,iVBORw0KGgo=";
    render(
      <Harness
        initial={note([
          { id: "image", type: "image", src: source, name: "原本.png" },
        ])}
      />,
    );
    fireEvent.change(screen.getByRole("slider", { name: "画像の幅" }), {
      target: { value: "60" },
    });
    expect(latestBlocks()[0].width).toBe(60);
    fireEvent.click(screen.getByRole("button", { name: "注釈" }));
    const stage = document.querySelector(".image-stage")!;
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 300,
      height: 200,
      right: 300,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON() {},
    });
    fireEvent.click(stage, { clientX: 150, clientY: 100 });
    fireEvent.change(screen.getByRole("textbox", { name: "注釈1" }), {
      target: { value: "重要な箇所" },
    });
    expect(latestBlocks()[0].annotations?.[0]).toMatchObject({
      x: 0.5,
      y: 0.5,
      text: "重要な箇所",
    });
    expect(latestBlocks()[0].src).toBe(source);
    fireEvent.click(screen.getByRole("button", { name: "原本に戻す" }));
    expect(latestBlocks()[0].src).toBe(source);
    expect(latestBlocks()[0].annotations).toEqual([]);
    expect(latestBlocks()[0].width).toBeUndefined();
  });

  it("adds table rows at the selected cell and retains editable cell text", () => {
    render(
      <Harness
        initial={note([
          {
            id: "table",
            type: "table",
            html: "<table><tbody><tr><td>甲</td><td>乙</td></tr><tr><td>丙</td><td>丁</td></tr></tbody></table>",
          },
        ])}
      />,
    );
    const editable = screen.getByRole("textbox", { name: "表を編集" });
    fireEvent.focus(editable);
    const cell = within(editable).getByText("甲");
    const range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.pointerUp(editable);
    fireEvent.click(screen.getByRole("button", { name: "その他の書式" }));
    fireEvent.click(screen.getByRole("button", { name: "表を編集" }));
    fireEvent.click(screen.getByRole("button", { name: "下に行を挿入" }));
    expect(editable.querySelectorAll("tr")).toHaveLength(3);
    expect(latestBlocks()[0].html).toContain("甲");
    expect(latestBlocks()[0].html?.match(/<tr>/g)).toHaveLength(3);
  });

  it("imports clipboard tables without flattening them and records the pasted original", () => {
    const capture = vi.fn();
    render(
      <Harness
        initial={note([{ id: "a", type: "text", html: "<p><br></p>" }])}
        capture={capture}
      />,
    );
    const editable = screen.getByRole("textbox", { name: "テキストを編集" });
    const html =
      "<table><tr><th>項目</th><th>値</th></tr><tr><td>保存</td><td>100</td></tr></table>";
    fireEvent.paste(editable, {
      clipboardData: {
        getData: (type: string) =>
          type === "text/html" ? html : "項目\t値\n保存\t100",
        files: [],
      },
    });
    expect(latestBlocks()).toHaveLength(1);
    expect(latestBlocks()[0].type).toBe("table");
    expect(latestBlocks()[0].html).toContain("<th>項目</th>");
    expect(capture).toHaveBeenCalledWith([
      expect.objectContaining({ kind: "html", content: html }),
    ]);
  });

  it("keeps rich clipboard text and attached image files together with every original representation", async () => {
    const capture = vi.fn(), notify = vi.fn();
    render(<Harness initial={note([{ id: "a", type: "text", html: "<p><br></p>" }])} capture={capture} notify={notify} />);
    const html = '<p style="color:#28745e"><strong>画像に添えた回答本文</strong></p><img src="https://example.com/source.png" alt="HTMLの画像">';
    const text = "画像に添えた回答本文\nHTMLの画像";
    const image = new File([new Uint8Array([137, 80, 78, 71])], "clipboard.png", { type: "image/png" });
    fireEvent.paste(screen.getByRole("textbox", { name: "テキストを編集" }), {
      clipboardData: { getData: (type: string) => type === "text/html" ? html : text, files: [image] },
    });
    await waitFor(() => expect(latestBlocks()).toHaveLength(3));
    expect(latestBlocks()[0].html).toContain("<strong>画像に添えた回答本文</strong>");
    expect(latestBlocks()[0].html).toContain("color:");
    expect(latestBlocks().filter(block => block.type === "image")).toHaveLength(2);
    expect(latestBlocks()[2].src).toMatch(/^data:image\/png;base64,/);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][0]).toEqual([
      expect.objectContaining({ kind: "html", content: html }),
      expect.objectContaining({ kind: "text", content: text }),
      expect.objectContaining({ kind: "image", name: "clipboard.png" }),
    ]);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("画像が重複する場合"));
    fireEvent.click(screen.getByRole("button", { name: "元に戻す (Ctrl+Z)" }));
    expect(latestBlocks()).toEqual([{ id: "a", type: "text", html: "<p><br></p>" }]);
  });

  it("keeps plain clipboard text when an image file accompanies it", async () => {
    const capture = vi.fn();
    render(<Harness initial={note([{ id: "a", type: "text", html: "<p><br></p>" }])} capture={capture} />);
    const text = "画像と一緒に残すプレーンテキスト";
    fireEvent.paste(screen.getByRole("textbox", { name: "テキストを編集" }), {
      clipboardData: {
        getData: (type: string) => type === "text/plain" ? text : "",
        files: [new File([new Uint8Array([137, 80, 78, 71])], "plain-image.png", { type: "image/png" })],
      },
    });
    await waitFor(() => expect(latestBlocks()).toHaveLength(2));
    expect(latestBlocks()[0].html).toContain(text);
    expect(latestBlocks()[1].type).toBe("image");
    expect(capture.mock.calls[0][0]).toEqual([
      expect.objectContaining({ kind: "text", content: text }),
      expect.objectContaining({ kind: "image", name: "plain-image.png" }),
    ]);
  });

  it("pastes an image-only clipboard without adding an empty text block or extra original", async () => {
    const capture = vi.fn(), notify = vi.fn();
    render(<Harness initial={note([{ id: "a", type: "text", html: "<p><br></p>" }])} capture={capture} notify={notify} />);
    fireEvent.paste(screen.getByRole("textbox", { name: "テキストを編集" }), {
      clipboardData: {
        getData: () => "",
        files: [new File([new Uint8Array([137, 80, 78, 71])], "image-only.png", { type: "image/png" })],
      },
    });
    await waitFor(() => expect(latestBlocks()[0].type).toBe("image"));
    expect(latestBlocks()).toHaveLength(1);
    expect(capture.mock.calls[0][0]).toEqual([expect.objectContaining({ kind: "image", name: "image-only.png" })]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("uses a native-paste fallback when browser clipboard access is denied", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { read: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(<Harness initial={note([])} />);
    fireEvent.click(
      screen.getByRole("button", { name: "クリップボードから貼り付け" }),
    );
    const textarea = await screen.findByRole("textbox", {
      name: "ここに貼り付け",
    });
    fireEvent.change(textarea, { target: { value: "Safariで通常の貼り付け" } });
    fireEvent.click(screen.getByRole("button", { name: "ノートに追加" }));
    expect(latestBlocks()[0].html).toContain("Safariで通常の貼り付け");
  });

  it("applies an external history restore even while an editable block has focus", () => {
    const first = note([
      { id: "same-block", type: "text", html: "<p>現在の文章</p>" },
    ]);
    const { rerender } = render(
      <Editor note={first} onChange={() => {}} onNotify={() => {}} />,
    );
    const editable = screen.getByRole("textbox", { name: "テキストを編集" });
    editable.focus();
    editable.innerHTML = "<p>編集中の文章</p>";
    fireEvent.input(editable);
    rerender(
      <Editor
        note={{
          ...first,
          blocks: [
            { id: "same-block", type: "text", html: "<p>過去の原稿</p>" },
          ],
        }}
        onChange={() => {}}
        onNotify={() => {}}
      />,
    );
    expect(editable.innerHTML).toBe("<p>過去の原稿</p>");
    expect(
      (
        screen.getByRole("button", {
          name: "元に戻す (Ctrl+Z)",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("resets undo between notes and cancels clipboard reads started in the previous note", async () => {
    let resolveRead!: (items: unknown[]) => void;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: () =>
          new Promise((resolve) => {
            resolveRead = resolve;
          }),
      },
    });
    const changed = vi.fn(),
      notify = vi.fn();
    const first = note(
      [{ id: "first-block", type: "text", html: "<p>ノートA</p>" }],
      "note-A",
    );
    const second = note(
      [{ id: "second-block", type: "text", html: "<p>ノートB</p>" }],
      "note-B",
    );
    const { rerender } = render(
      <Editor note={first} onChange={changed} onNotify={notify} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "クリップボードから貼り付け" }),
    );
    rerender(<Editor note={second} onChange={changed} onNotify={notify} />);
    await act(async () => {
      resolveRead([
        {
          types: ["text/html"],
          getType: async () => ({
            text: async () => "<p>前のノートへの貼り付け</p>",
          }),
        },
      ]);
    });
    expect(changed).not.toHaveBeenCalled();
    expect(
      screen.getByRole("textbox", { name: "テキストを編集" }).textContent,
    ).toBe("ノートB");
    expect(notify).toHaveBeenCalledWith(
      "ノートを切り替えたため、貼り付けを中止しました。",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "元に戻す (Ctrl+Z)",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("displays image zoom in original source pixels and closes with Escape", () => {
    const close = vi.fn();
    render(
      <ImageLightbox
        src="data:image/png;base64,iVBORw0KGgo="
        name="原本.png"
        onClose={close}
      />,
    );
    const image = screen.getByRole("img", { name: "原本.png" });
    Object.defineProperty(image, "naturalWidth", {
      configurable: true,
      value: 1200,
    });
    fireEvent.load(image);
    expect(image.style.width).toBe("1200px");
    fireEvent.change(screen.getByRole("combobox", { name: "画像の表示倍率" }), {
      target: { value: "200" },
    });
    expect(image.style.width).toBe("2400px");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("edits a long Japanese note with 100 embedded images and round-trips its complete backup", async () => {
    const longText = "知識を育てるノート。".repeat(10000);
    expect(longText.length).toBeGreaterThanOrEqual(100000);
    const imageSource =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6gAAAABJRU5ErkJggg==";
    const initial = note([
      { id: "long-text", type: "text", html: `<p>${longText}</p>` },
      ...Array.from({ length: 100 }, (_, index): Block => ({
        id: `image-${index}`,
        type: "image",
        src: imageSource,
        name: `原本-${index}.png`,
        width: 100,
        annotations: [],
      })),
    ]);
    render(<Harness initial={initial} />);
    expect(screen.getAllByRole("img")).toHaveLength(100);
    const editable = screen.getByRole("textbox", { name: "テキストを編集" });
    editable.focus();
    editable.innerHTML = `<p>${longText}追記した日本語</p>`;
    fireEvent.input(editable);
    const edited = latestBlocks();
    expect(edited).toHaveLength(101);
    expect(edited[0].html?.length).toBe(
      longText.length + "追記した日本語".length + 7,
    );
    expect(edited.slice(1).every((block) => block.src === imageSource)).toBe(
      true,
    );
    const html = blocksToHtml(edited);
    expect(html.match(/<img /g)).toHaveLength(100);
    expect(blocksToText(edited).startsWith(longText + "追記した日本語")).toBe(
      true,
    );
    const backup = await createBackupText({
      schemaVersion: 1,
      notes: [{ ...initial, blocks: edited }],
      folders: [],
    });
    const restored = await parseBackup(backup);
    expect(restored.notes[0].blocks).toEqual(edited);
    fireEvent.click(screen.getByRole("button", { name: "元に戻す (Ctrl+Z)" }));
    expect(latestBlocks()[0].html).toBe(initial.blocks[0].html);
    expect(
      latestBlocks().filter((block) => block.type === "image"),
    ).toHaveLength(100);
  });
});
