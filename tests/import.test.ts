import { afterEach, describe, expect, it, vi } from "vitest";
import {
  blocksToHtml,
  blocksToText,
  copyBlocks,
  createBackupText,
  filesToContent,
  htmlToBlocks,
  markdownToBlocks,
  parseBackup,
  sanitizeHtml,
  textToBlocks,
  validateWorkspace,
} from "../src/core/import";
import { seedWorkspace } from "../src/core/seed";

describe("safe and faithful import", () => {
  it("removes active content, external styles, unsafe image URLs and CSS fetches", () => {
    const clean = sanitizeHtml(
      '<link rel="stylesheet" href="https://evil.test/style.css"><style>body{display:none}</style><script>alert(1)</script><iframe src="https://evil.test"></iframe><div onclick="alert(1)" style="color: rgb(10, 20, 30);background-image:url(https://evil.test/a);position:fixed;display:grid;grid-template-columns:1fr 1fr"><img src="javascript:alert(1)" onerror="alert(1)"><a href="javascript:alert(1)">危険</a><strong>安全</strong></div>',
    );
    expect(clean).not.toMatch(
      /<script|<style|<link|<iframe|onclick|onerror|javascript:|background-image|position:fixed/,
    );
    expect(clean).toContain("display:grid");
    expect(clean).toContain("grid-template-columns:1fr 1fr");
    expect(clean).toContain("<strong>安全</strong>");
  });

  it("keeps cards, multiple columns, tables, SVG and MathML as useful DOM", () => {
    const html =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px"><section style="padding:16px;background-color:#fafafa"><h3>比較</h3><table><tr><td style="width:120px;background-color:#eee">元のセル</td></tr></table></section><section><svg viewBox="0 0 100 20"><rect width="50" height="20" fill="green"></rect><text x="3" y="14">図</text></svg><math><msup><mi>x</mi><mn>2</mn></msup></math></section></div>';
    const blocks = htmlToBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("html");
    expect(blocks[0].html).toContain("grid-template-columns:1fr 1fr");
    expect(blocks[0].html).toContain("<table>");
    expect(blocks[0].html).toContain("width:120px");
    expect(blocks[0].html).toContain("<svg");
    expect(blocks[0].html).toContain("<math>");
  });

  it("unpacks a rich response wrapper into independently movable semantic blocks", () => {
    const blocks = htmlToBlocks(
      '<div class="markdown prose"><h2>回答</h2><p>本文</p><table><tr><td>比較</td></tr></table><pre><code>&lt;script&gt;文字として保存&lt;/script&gt;</code></pre></div>',
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "text",
      "table",
      "code",
    ]);
    expect(blocks[3].html).toBe("<script>文字として保存</script>");
    expect(blocksToHtml([blocks[3]])).toContain("&lt;script&gt;");
  });

  it("preserves plain text spaces, indentation and blank lines through import and copy", () => {
    const text = "  見出しの前に空白\n本文  間の空白\n\n\n\n次の段落\n";
    const blocks = textToBlocks(text);
    expect(blocksToHtml(blocks)).toContain("white-space:pre-wrap");
    expect(blocksToText(blocks)).toBe(text);
  });

  it("creates editable Markdown headings, lists, table, code and display math", () => {
    const blocks = markdownToBlocks(
      "# 学習メモ\n\n- 項目A\n- 項目B\n\n|年|出来事|\n|---|---|\n|1603|開幕|\n\n```js\nconst x = 1;\n```\n\n$$\nx^2 + y^2 = z^2\n$$",
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "text",
      "table",
      "code",
      "math",
    ]);
    expect(blocksToHtml(blocks)).toContain("katex");
    expect(blocksToText(blocks)).toContain("1603\t開幕");
    expect(blocksToText(blocks)).toContain("const x = 1;");
  });

  it("supports inline math and does not parse math delimiters inside fenced code", () => {
    const blocks = markdownToBlocks(
      "面積は $r^2\\pi$ です。\n\n```text\n$$\nこれはコード\n$$\n```\n\n$$E=mc^2$$",
    );
    expect(blocks.map((b) => b.type)).toEqual(["text", "code", "math"]);
    expect(blocks[0].html).toContain("katex");
    expect(blocks[1].html).toBe("$$\nこれはコード\n$$\n");
    expect(blocks[2].html).toBe("E=mc^2");
    expect(blocksToHtml([blocks[1]])).toBe(
      "<pre><code>$$\nこれはコード\n$$\n</code></pre>",
    );
  });

  it("retains exact screenshot bytes and a separate original", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const content = await filesToContent(
      [new File([bytes], "capture.png", { type: "image/png" })],
      "original",
    );
    expect(content.blocks[0].src).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(content.originals[0].content).toBe(content.blocks[0].src);
    expect(content.originals[0].kind).toBe("image");
    expect(content.blocks[0].type).toBe("image");
  });
});

describe("clipboard interoperability", () => {
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );
  afterEach(() => {
    vi.unstubAllGlobals();
    if (clipboardDescriptor)
      Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    else delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  });
  it("writes HTML, plain text and exact PNG bytes together for a screenshot", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    vi.stubGlobal(
      "ClipboardItem",
      class {
        static supports = () => true;
        constructor(public representations: Record<string, Blob>) {}
      },
    );
    await copyBlocks([
      {
        id: "image",
        type: "image",
        src: "data:image/png;base64,iVBORw0KGgo=",
        name: "原本.png",
      },
    ]);
    const item = write.mock.calls[0][0][0] as {
      representations: Record<string, Blob>;
    };
    expect(Object.keys(item.representations)).toEqual([
      "text/html",
      "text/plain",
      "image/png",
    ]);
    expect(item.representations["image/png"].size).toBe(8);
    expect(item.representations["text/html"].type).toBe("text/html");
  });
  it("explains the native selection fallback when the clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    await expect(
      copyBlocks([{ id: "text", type: "text", html: "<p>コピーする文章</p>" }]),
    ).rejects.toThrow("長押し");
    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
  });
});

describe("backup safety", () => {
  it("round-trips all content with a SHA-256 integrity check", async () => {
    const original = seedWorkspace();
    const backup = await createBackupText(original);
    expect(await parseBackup(backup)).toEqual(original);
    const tampered = JSON.parse(backup);
    tampered.workspace.notes[0].title = "改変";
    await expect(parseBackup(JSON.stringify(tampered))).rejects.toThrow(
      "整合性チェック",
    );
    expect(original.notes[0].title).toBe("AIの回答を、使える知識に。");
  });

  it("round-trips image bytes, untouched raw HTML, annotations and revision checkpoints", async () => {
    const workspace = seedWorkspace(),
      note = workspace.notes[0];
    const image = {
      id: "image",
      type: "image" as const,
      src: "data:image/png;base64,iVBORw0KGgo=",
      name: "原本.png",
      width: 72,
      caption: "図の説明",
      annotations: [
        { id: "annotation", x: 0.245, y: 0.6, text: "確認したい箇所" },
      ],
    };
    note.blocks.push(image);
    note.originals.push(
      { kind: "image", content: image.src, capturedAt: note.createdAt },
      {
        kind: "html",
        content: "<script>source retained only</script><p>原本</p>",
        capturedAt: note.createdAt,
      },
    );
    note.revisions.push({
      id: "revision",
      at: note.createdAt,
      title: "編集前",
      blocks: structuredClone(note.blocks),
    });
    const restored = await parseBackup(await createBackupText(workspace));
    expect(restored).toEqual(workspace);
    expect(blocksToHtml([image])).toContain("注釈 (25%, 60%)");
    expect(restored.notes[0].originals[1].content).toContain("<script>");
    expect(sanitizeHtml(restored.notes[0].originals[1].content)).not.toContain(
      "<script>",
    );
    restored.notes[0].blocks[0].html = "別の内容";
    expect(workspace.notes[0].blocks[0].html).not.toBe("別の内容");
  });

  it("imports a single exported note with new IDs, original metadata and histories", async () => {
    const note = seedWorkspace().notes[0];
    note.originals = [
      { kind: "text", content: "原本の情報", capturedAt: note.createdAt },
    ];
    note.revisions = [
      {
        id: "history",
        title: "過去の見出し",
        at: note.createdAt,
        blocks: structuredClone(note.blocks),
      },
    ];
    const json = JSON.stringify({ format: "folio-note", version: 1, note });
    const file = Object.assign(
      new File([json], "note.json", { type: "application/json" }),
      { text: async () => json },
    );
    const content = await filesToContent([file], "editable");
    expect(content.importedNote!.title).toBe(note.title);
    expect(content.importedNote!.tags).toEqual(note.tags);
    expect(content.importedNote!.revisions[0].title).toBe("過去の見出し");
    expect(content.importedNote!.revisions[0].id).not.toBe("history");
    expect(content.importedNote!.id).not.toBe(note.id);
    expect(content.blocks[0].id).not.toBe(note.blocks[0].id);
    expect(content.originals).toEqual(note.originals);
    expect(content.importedNote!.folderId).toBeNull();
    const malformed = JSON.stringify({
      format: "folio-note",
      version: 1,
      note: {
        ...note,
        blocks: [{ id: "bad", type: "image", src: "javascript:alert(1)" }],
      },
    });
    const badFile = Object.assign(
      new File([malformed], "bad.json", { type: "application/json" }),
      { text: async () => malformed },
    );
    await expect(filesToContent([badFile], "editable")).rejects.toThrow(
      "安全でない",
    );
  });

  it("rejects malformed, unsupported, cyclic, duplicate and unsafe-image imports", async () => {
    await expect(parseBackup("{ broken")).rejects.toThrow("JSON");
    await expect(parseBackup('{"schemaVersion":1}')).rejects.toThrow("Folio");
    const wrongVersion = seedWorkspace() as unknown as {
      schemaVersion: number;
    };
    wrongVersion.schemaVersion = 2;
    expect(() => validateWorkspace(wrongVersion)).toThrow("バージョン");
    const cyclic = seedWorkspace();
    cyclic.folders[0].parentId = cyclic.folders[0].id;
    expect(() => validateWorkspace(cyclic)).toThrow("階層");
    const duplicate = seedWorkspace();
    duplicate.notes.push(duplicate.notes[0]);
    expect(() => validateWorkspace(duplicate)).toThrow("不整合");
    const unsafe = seedWorkspace();
    unsafe.notes[0].blocks = [
      { id: "unsafe", type: "image", src: "javascript:alert(1)" },
    ];
    expect(() => validateWorkspace(unsafe)).toThrow("安全でない");
  });
});
