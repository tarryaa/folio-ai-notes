import DOMPurify from "dompurify";
import { marked } from "marked";
import katex from "katex";
import {
  uid,
  type Block,
  type Note,
  type Original,
  type Workspace,
} from "./types";

marked.use({
  extensions: [
    {
      name: "inlineMath",
      level: "inline",
      start(source) {
        const match = source.match(/\$|\\\(/);
        return match?.index;
      },
      tokenizer(source) {
        const match = source.match(
          /^(?:\\\((.+?)\\\)|\$(?!\$)([^\n$]+?)\$(?!\$))/,
        );
        if (match)
          return {
            type: "inlineMath",
            raw: match[0],
            text: match[1] || match[2],
          };
      },
      renderer(token) {
        return katex.renderToString(String(token.text || ""), {
          throwOnError: false,
          trust: false,
          output: "htmlAndMathml",
        });
      },
    },
  ],
});

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const styleProperties = new Set(
  "color background-color font-family font-size font-style font-weight text-align text-decoration text-decoration-color text-transform line-height letter-spacing white-space word-break overflow-wrap vertical-align display grid-template-columns grid-template-rows gap row-gap column-gap flex flex-direction flex-wrap align-items justify-content width min-width max-width height min-height max-height margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left border border-width border-style border-color border-top border-right border-bottom border-left border-radius border-collapse border-spacing table-layout opacity overflow overflow-x overflow-y box-sizing position top right bottom left transform transform-origin".split(
    " ",
  ),
);
const plainTextCache = new Map<string, string>();
let plainTextCacheSize = 0;
function cachePlainText(source: string, plain: string): void {
  const size = source.length + plain.length;
  if (size > 5_000_000) return;
  while (plainTextCache.size >= 128 || plainTextCacheSize + size > 5_000_000) {
    const oldest = plainTextCache.keys().next().value;
    if (oldest === undefined) break;
    plainTextCacheSize -= oldest.length + plainTextCache.get(oldest)!.length;
    plainTextCache.delete(oldest);
  }
  plainTextCache.set(source, plain);
  plainTextCacheSize += size;
}

export function isSafeImageUrl(value: string): boolean {
  if (
    /^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,[a-z\d+/=\s]+$/i.test(
      value,
    )
  )
    return true;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol);
  } catch {
    return false;
  }
}

/** Raw sources are retained separately; only this sanitized representation is rendered. */
export function sanitizeHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    FORBID_TAGS: [
      "script",
      "style",
      "iframe",
      "object",
      "embed",
      "link",
      "meta",
      "base",
      "form",
      "input",
      "button",
      "textarea",
      "select",
      "video",
      "audio",
      "foreignObject",
    ],
    FORBID_ATTR: ["srcset", "formaction", "autofocus", "contenteditable"],
    ALLOW_DATA_ATTR: false,
  });
  const template = document.createElement("template");
  template.innerHTML = clean;
  for (const element of template.content.querySelectorAll("*")) {
    for (const attr of Array.from(element.attributes)) {
      if (/^on/i.test(attr.name)) element.removeAttribute(attr.name);
      if (
        /url\s*\(/i.test(attr.value) &&
        !/^url\(\s*["']?#[a-z\d_.:-]+["']?\s*\)$/i.test(attr.value) &&
        attr.name !== "style"
      )
        element.removeAttribute(attr.name);
      if (["background", "poster"].includes(attr.name.toLowerCase()))
        element.removeAttribute(attr.name);
    }
    if (element.hasAttribute("style")) {
      const source = (element as HTMLElement).style;
      const safe: string[] = [];
      for (let i = 0; i < source.length; i++) {
        const property = source.item(i).toLowerCase();
        const value = source.getPropertyValue(property).trim();
        if (
          !styleProperties.has(property) ||
          /url\s*\(|expression\s*\(|@import|javascript:|behavior|var\s*\(|attr\s*\(|\\/i.test(
            value,
          )
        )
          continue;
        if (property === "position" && !["static", "relative"].includes(value))
          continue;
        safe.push(`${property}:${value}`);
      }
      if (safe.length) element.setAttribute("style", safe.join(";"));
      else element.removeAttribute("style");
    }
    if (element.tagName.toLowerCase() === "img") {
      if (!isSafeImageUrl(element.getAttribute("src") || "")) {
        const placeholder = document.createElement("span");
        placeholder.textContent = `[画像を読み込めません${element.getAttribute("alt") ? `：${element.getAttribute("alt")}` : ""}]`;
        element.replaceWith(placeholder);
      }
      element.setAttribute("loading", "lazy");
      element.setAttribute("referrerpolicy", "no-referrer");
    }
    for (const name of ["href", "xlink:href"]) {
      const href = element.getAttribute(name);
      if (!href) continue;
      if (element.tagName.toLowerCase() !== "a") {
        if (!/^#[a-z\d_.:-]+$/i.test(href)) element.removeAttribute(name);
      } else {
        try {
          const target = new URL(href, location.href);
          if (!["https:", "http:", "mailto:", "tel:"].includes(target.protocol))
            element.removeAttribute(name);
        } catch {
          element.removeAttribute(name);
        }
        element.setAttribute("rel", "noopener noreferrer");
        element.setAttribute("target", "_blank");
      }
    }
  }
  return template.innerHTML;
}

export function htmlToBlocks(html: string): Block[] {
  const documentFragment = document.createElement("template");
  documentFragment.innerHTML = sanitizeHtml(html);
  const blocks: Block[] = [];
  function visit(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent?.trim())
        blocks.push({
          id: uid(),
          type: "text",
          html: `<p>${escapeHtml(node.textContent)}</p>`,
        });
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toLowerCase();
    const classes = typeof node.className === "string" ? node.className : "";
    const plainWrapper =
      !classes ||
      (/markdown|prose|response|message|content/i.test(classes) &&
        !/grid|flex|columns|cards?|katex|math|diagram|chart/i.test(classes));
    // Plain document wrappers can be unpacked; styled cards and columns remain intact.
    if (
      ["article", "main", "section", "div"].includes(tag) &&
      !node.hasAttribute("style") &&
      !node.querySelector("svg,math") &&
      plainWrapper &&
      Array.from(node.children).some((c) =>
        /^(P|H[1-6]|TABLE|UL|OL|DIV|SECTION|PRE|BLOCKQUOTE)$/.test(c.tagName),
      )
    ) {
      Array.from(node.childNodes).forEach(visit);
      return;
    }
    if (tag === "img") {
      blocks.push({
        id: uid(),
        type: "image",
        src: node.getAttribute("src")!,
        name: node.getAttribute("alt") || "取り込んだ画像",
        width: 100,
        annotations: [],
      });
    } else if (tag === "hr") blocks.push({ id: uid(), type: "divider" });
    else if (tag === "pre")
      blocks.push({ id: uid(), type: "code", html: node.textContent || "" });
    else {
      const type = /^h[1-6]$/.test(tag)
        ? "heading"
        : tag === "table"
          ? "table"
          : tag === "blockquote"
            ? "quote"
            : ["p", "ul", "ol"].includes(tag)
              ? "text"
              : "html";
      blocks.push({ id: uid(), type, html: node.outerHTML });
    }
  }
  Array.from(documentFragment.content.childNodes).forEach(visit);
  return blocks;
}

export function textToBlocks(text: string): Block[] {
  if (!text) return [];
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\n/)
    .map((paragraph) => ({
      id: uid(),
      type: "text",
      html: `<p style="white-space:pre-wrap">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`,
    }));
}

export function markdownToBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n"),
    blocks: Block[] = [];
  let pending: string[] = [],
    fence: { marker: string; length: number } | null = null;
  const flushMarkdown = () => {
    if (pending.join("\n").trim())
      blocks.push(
        ...htmlToBlocks(
          marked.parse(pending.join("\n"), {
            async: false,
            gfm: true,
          }) as string,
        ),
      );
    pending = [];
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index],
      fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence)
        fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
      else if (
        fence.marker === fenceMatch[1][0] &&
        fenceMatch[1].length >= fence.length
      )
        fence = null;
      pending.push(line);
      continue;
    }
    if (fence) {
      pending.push(line);
      continue;
    }
    const oneLine = line.match(/^\s*(?:\$\$(.+?)\$\$|\\\[(.+?)\\\])\s*$/);
    if (oneLine) {
      flushMarkdown();
      blocks.push({ id: uid(), type: "math", html: oneLine[1] || oneLine[2] });
      continue;
    }
    if (/^\s*(?:\$\$|\\\[)\s*$/.test(line)) {
      const closing = line.trim() === "$$" ? "$$" : "\\]";
      const end = lines.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex > index && candidate.trim() === closing,
      );
      if (end !== -1) {
        flushMarkdown();
        blocks.push({
          id: uid(),
          type: "math",
          html: lines.slice(index + 1, end).join("\n"),
        });
        index = end;
        continue;
      }
    }
    pending.push(line);
  }
  flushMarkdown();
  return blocks;
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new Error(`「${file.name}」を読み込めませんでした。`));
    reader.readAsDataURL(file);
  });
}

export async function filesToContent(
  files: File[],
  mode: "editable" | "original",
): Promise<{
  blocks: Block[];
  originals: Original[];
  warnings: string[];
  importedNote?: Note;
}> {
  const blocks: Block[] = [],
    originals: Original[] = [],
    warnings: string[] = [];
  let importedNote: Note | undefined;
  for (const file of files) {
    if (file.size > 40 * 1024 * 1024)
      throw new Error(
        `「${file.name}」は40 MBを超えています。小さいファイルに分けてください。`,
      );
    const capturedAt = new Date().toISOString();
    if (
      /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(file.type) ||
      /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(file.name)
    ) {
      const src = await readDataUrl(file);
      if (!isSafeImageUrl(src))
        throw new Error(
          `「${file.name}」の画像形式を読み込めませんでした。PNG・JPEG・WebPをお試しください。`,
        );
      originals.push({
        kind: "image",
        content: src,
        name: file.name,
        capturedAt,
      });
      blocks.push({
        id: uid(),
        type: "image",
        src,
        name: file.name,
        width: 100,
        annotations: [],
      });
      continue;
    }
    if (mode === "original")
      throw new Error(
        "原本保存ではPNG・JPEG・WebPなどの画像ファイルを選んでください。HTML・Markdown・ノートJSONは編集できる取り込みをご利用ください。",
      );
    const text = await file.text();
    if (/\.json$/i.test(file.name) || file.type === "application/json") {
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`「${file.name}」をJSONとして読み込めませんでした。`);
      }
      if (
        !isObject(data) ||
        data.format !== "folio-note" ||
        data.version !== 1 ||
        !isObject(data.note)
      )
        throw new Error(
          "「ノートデータ（JSON）」から書き出したFolioのノートを選んでください。全データのバックアップは「設定とバックアップ」から復元できます。",
        );
      const validated = validateWorkspace({
        schemaVersion: 1,
        folders: [],
        notes: [{ ...data.note, folderId: null }],
      }).notes[0];
      const reidentifyBlocks = (source: Block[]): Block[] =>
        source.map((block) => ({
          ...block,
          id: uid(),
          ...(block.annotations
            ? {
                annotations: block.annotations.map((a) => ({
                  ...a,
                  id: uid(),
                })),
              }
            : {}),
        }));
      const note: Note = {
        ...validated,
        id: uid(),
        folderId: null,
        deletedAt: null,
        blocks: reidentifyBlocks(validated.blocks),
        revisions: validated.revisions.map((r) => ({
          ...r,
          id: uid(),
          blocks: reidentifyBlocks(r.blocks),
        })),
      };
      blocks.push(...note.blocks);
      originals.push(...note.originals);
      if (files.length === 1) importedNote = note;
      else
        warnings.push(
          "複数ファイルの取り込みではノートの本文と原本をまとめます。タイトル・タグ・履歴も復元するには、ノートJSONを1件ずつ取り込んでください。",
        );
    } else if (/\.html?$/i.test(file.name) || file.type === "text/html") {
      originals.push({
        kind: "html",
        content: text,
        name: file.name,
        capturedAt,
      });
      blocks.push(...htmlToBlocks(text));
      if (/<img[^>]+src\s*=\s*["']?https?:/i.test(text))
        warnings.push(
          "外部URLの画像は通信と配信元に依存します。確実に残すには画像ファイルも取り込んでください。",
        );
    } else if (
      /\.(md|markdown)$/i.test(file.name) ||
      file.type === "text/markdown"
    ) {
      originals.push({
        kind: "markdown",
        content: text,
        name: file.name,
        capturedAt,
      });
      blocks.push(...markdownToBlocks(text));
    } else if (
      /\.(txt|csv|log)$/i.test(file.name) ||
      file.type === "text/plain"
    ) {
      originals.push({
        kind: "text",
        content: text,
        name: file.name,
        capturedAt,
      });
      blocks.push(...textToBlocks(text));
    } else
      throw new Error(
        `「${file.name}」は対応していない形式です。HTML・Markdown・テキスト・画像・ノートJSONを選んでください。`,
      );
  }
  if (
    blocks.some(
      (block) =>
        (block.type === "image" && /^https?:/i.test(block.src || "")) ||
        /<img[^>]+src\s*=\s*["']?https?:/i.test(block.html || ""),
    )
  )
    warnings.push(
      "外部URLの画像は通信と配信元に依存します。確実に残すには画像ファイルも取り込んでください。",
    );
  return {
    blocks,
    originals,
    warnings: [...new Set(warnings)],
    ...(importedNote ? { importedNote } : {}),
  };
}

export function blocksToHtml(blocks: Block[]): string {
  return blocks
    .map((block) => {
      if (block.type === "divider") return "<hr>";
      if (block.type === "code")
        return `<pre><code>${escapeHtml(block.html || "")}</code></pre>`;
      if (block.type === "image")
        return isSafeImageUrl(block.src || "")
          ? `<figure><img src="${escapeHtml(block.src!)}" alt="${escapeHtml(block.name || "")}" style="max-width:100%;width:${Math.max(10, Math.min(100, block.width || 100))}%">${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ""}${(block.annotations || []).map((a) => `<p>注釈 (${Math.round(a.x * 100)}%, ${Math.round(a.y * 100)}%): ${escapeHtml(a.text)}</p>`).join("")}</figure>`
          : "";
      if (block.type === "math") {
        try {
          return katex.renderToString(block.html || "", {
            displayMode: true,
            throwOnError: false,
            trust: false,
            output: "htmlAndMathml",
          });
        } catch {
          return `<pre>${escapeHtml(block.html || "")}</pre>`;
        }
      }
      return sanitizeHtml(block.html || "");
    })
    .join("\n");
}

export function blocksToText(blocks: Block[]): string {
  function readable(node: Node, preserve = false): string {
    if (node.nodeType === Node.TEXT_NODE)
      return preserve
        ? node.textContent || ""
        : (node.textContent || "").replace(/\s+/g, " ");
    if (!(node instanceof Element)) return "";
    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "\n";
    if (tag === "pre") return (node.textContent || "") + "\n";
    if (tag === "table")
      return Array.from(node.querySelectorAll("tr"))
        .map((row) =>
          Array.from(row.querySelectorAll("th,td"))
            .map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim())
            .join("\t"),
        )
        .join("\n");
    const preserveHere =
      preserve ||
      /^(pre|pre-wrap|break-spaces)$/.test(
        (node as HTMLElement).style?.whiteSpace || "",
      );
    const content = Array.from(node.childNodes)
      .map((child) => readable(child, preserveHere))
      .join("");
    return /^(p|li|h[1-6]|blockquote|div)$/.test(tag)
      ? content + "\n"
      : content;
  }
  return blocks
    .map((block) => {
      if (block.type === "image")
        return `[画像: ${block.name || "画像"}]${block.caption ? ` ${block.caption}` : ""}`;
      if (block.type === "divider") return "—";
      if (block.type === "code") return block.html || "";
      if (block.type === "math") return block.html || "";
      const source = block.html || "",
        cached = plainTextCache.get(source);
      if (cached !== undefined) return cached;
      const div = document.createElement("div");
      div.innerHTML = sanitizeHtml(source);
      const preserve = Array.from(div.querySelectorAll("[style]")).some(
        (node) =>
          /^(pre|pre-wrap|break-spaces)$/.test(
            (node as HTMLElement).style.whiteSpace,
          ),
      );
      const rendered = Array.from(div.childNodes)
        .map((node) => readable(node))
        .join("");
      const plain = preserve ? rendered.replace(/\n$/, "") : rendered.trim();
      cachePlainText(source, plain);
      return plain;
    })
    .join("\n\n");
}

export async function copyBlocks(blocks: Block[]): Promise<void> {
  const html = blocksToHtml(blocks),
    text = blocksToText(blocks);
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      const representations: Record<string, Blob> = {
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      };
      const png =
        blocks.length === 1 && blocks[0].type === "image"
          ? blocks[0].src?.match(/^data:image\/png;base64,([a-z\d+/=\s]+)$/i)
          : null;
      if (
        png &&
        (typeof ClipboardItem.supports !== "function" ||
          ClipboardItem.supports("image/png"))
      ) {
        representations["image/png"] = new Blob(
          [
            Uint8Array.from(atob(png[1].replace(/\s/g, "")), (character) =>
              character.charCodeAt(0),
            ),
          ],
          { type: "image/png" },
        );
      }
      await navigator.clipboard.write([new ClipboardItem(representations)]);
    } else if (navigator.clipboard?.writeText)
      await navigator.clipboard.writeText(text);
    else throw new Error("unavailable");
  } catch {
    // execCommand still provides a user-gesture fallback on older Safari.
    const selection = window.getSelection(),
      ranges: Range[] = [];
    if (selection)
      for (let i = 0; i < selection.rangeCount; i++)
        ranges.push(selection.getRangeAt(i).cloneRange());
    const holder = document.createElement("div");
    holder.contentEditable = "true";
    holder.style.cssText = "position:fixed;left:-10000px;top:0;";
    holder.innerHTML = html;
    document.body.append(holder);
    try {
      const range = document.createRange();
      range.selectNodeContents(holder);
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (
        typeof document.execCommand !== "function" ||
        !document.execCommand("copy")
      )
        throw new Error(
          "このブラウザではコピーを許可できませんでした。本文を長押しして選択し、通常のコピー操作をお試しください。",
        );
    } finally {
      holder.remove();
      selection?.removeAllRanges();
      ranges.forEach((range) => selection?.addRange(range));
    }
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isString = (value: unknown, max = 2_000_000): value is string =>
  typeof value === "string" && value.length <= max;
const isDate = (value: unknown): value is string =>
  isString(value, 100) && Number.isFinite(Date.parse(value));
const invalid = (message: string): never => {
  throw new Error(`バックアップの形式が正しくありません：${message}`);
};
const blockTypes = new Set([
  "text",
  "heading",
  "image",
  "table",
  "code",
  "quote",
  "divider",
  "math",
  "html",
]);

export function validateWorkspace(value: unknown): Workspace {
  if (
    !isObject(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.notes) ||
    !Array.isArray(value.folders)
  )
    return invalid("対応するデータバージョンではありません。");
  if (value.notes.length > 100_000 || value.folders.length > 20_000)
    return invalid("項目数が上限を超えています。");
  const folderIds = new Set<string>();
  for (const folder of value.folders) {
    if (
      !isObject(folder) ||
      !isString(folder.id, 200) ||
      !folder.id ||
      folderIds.has(folder.id) ||
      !isString(folder.name, 500) ||
      !(folder.parentId === null || isString(folder.parentId, 200)) ||
      !Number.isFinite(folder.order)
    )
      return invalid("フォルダ情報に不整合があります。");
    folderIds.add(folder.id);
  }
  const parents = new Map(
    value.folders.map((f) => [f.id as string, f.parentId as string | null]),
  );
  for (const folder of value.folders) {
    const visited = new Set<string>([folder.id]);
    let parent = folder.parentId;
    while (parent !== null) {
      if (!folderIds.has(parent) || visited.has(parent))
        return invalid("フォルダの階層に不整合があります。");
      visited.add(parent);
      parent = parents.get(parent) ?? null;
    }
  }
  function validateBlocks(blocks: unknown): void {
    if (!Array.isArray(blocks) || blocks.length > 100_000)
      return invalid("ブロック情報が不足しています。");
    const ids = new Set<string>();
    for (const block of blocks) {
      if (
        !isObject(block) ||
        !isString(block.id, 200) ||
        !block.id ||
        ids.has(block.id) ||
        !blockTypes.has(String(block.type))
      )
        return invalid("ブロック情報に不整合があります。");
      ids.add(block.id);
      if (block.html !== undefined && !isString(block.html, 50_000_000))
        return invalid("本文が正しくありません。");
      if (
        block.src !== undefined &&
        (!isString(block.src, 80_000_000) || !isSafeImageUrl(block.src))
      )
        return invalid("安全でない画像URLがあります。");
      for (const key of ["name", "caption"])
        if (block[key] !== undefined && !isString(block[key], 10_000))
          return invalid("画像の説明が正しくありません。");
      if (
        block.width !== undefined &&
        (typeof block.width !== "number" ||
          !Number.isFinite(block.width) ||
          block.width <= 0 ||
          block.width > 10_000)
      )
        return invalid("画像の大きさが正しくありません。");
      if (
        block.annotations !== undefined &&
        (!Array.isArray(block.annotations) ||
          block.annotations.some(
            (a) =>
              !isObject(a) ||
              !isString(a.id, 200) ||
              !isString(a.text, 100_000) ||
              typeof a.x !== "number" ||
              typeof a.y !== "number" ||
              !Number.isFinite(a.x) ||
              !Number.isFinite(a.y) ||
              a.x < 0 ||
              a.x > 1 ||
              a.y < 0 ||
              a.y > 1,
          ))
      )
        return invalid("注釈が正しくありません。");
    }
  }
  const noteIds = new Set<string>();
  for (const note of value.notes) {
    if (
      !isObject(note) ||
      !isString(note.id, 200) ||
      !note.id ||
      noteIds.has(note.id) ||
      !isString(note.title, 10_000) ||
      !(
        note.folderId === null ||
        (typeof note.folderId === "string" && folderIds.has(note.folderId))
      ) ||
      typeof note.favorite !== "boolean" ||
      typeof note.pinned !== "boolean" ||
      !isDate(note.createdAt) ||
      !isDate(note.updatedAt) ||
      !(note.deletedAt === null || isDate(note.deletedAt)) ||
      !Number.isFinite(note.order) ||
      !Array.isArray(note.tags) ||
      note.tags.length > 1000 ||
      note.tags.some((t) => !isString(t, 200))
    )
      return invalid("ノート情報に不整合があります。");
    noteIds.add(note.id);
    validateBlocks(note.blocks);
    if (note.sourceUrl !== undefined && !isString(note.sourceUrl, 10_000))
      return invalid("取り込み元URLが正しくありません。");
    if (
      !Array.isArray(note.originals) ||
      note.originals.some(
        (o) =>
          !isObject(o) ||
          !["html", "text", "markdown", "image"].includes(String(o.kind)) ||
          !isString(o.content, 80_000_000) ||
          (o.kind === "image" && !isSafeImageUrl(o.content)) ||
          !isDate(o.capturedAt) ||
          (o.name !== undefined && !isString(o.name, 10_000)),
      )
    )
      return invalid("原本情報が正しくありません。");
    if (!Array.isArray(note.revisions) || note.revisions.length > 50)
      return invalid("編集履歴が上限（50件）を超えています。");
    for (const revision of note.revisions) {
      if (
        !isObject(revision) ||
        !isString(revision.id, 200) ||
        !isDate(revision.at) ||
        !isString(revision.title, 10_000)
      )
        return invalid("編集履歴が正しくありません。");
      validateBlocks(revision.blocks);
    }
  }
  // Never expose the caller's object as live state.
  return structuredClone(value) as unknown as Workspace;
}

async function checksum(workspace: Workspace): Promise<string> {
  if (!crypto.subtle)
    throw new Error(
      "安全なバックアップにはHTTPSまたはlocalhostでアプリを開いてください。",
    );
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(workspace)),
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createBackupText(workspace: Workspace): Promise<string> {
  const validated = validateWorkspace(workspace);
  return JSON.stringify(
    {
      format: "folio-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      checksum: await checksum(validated),
      workspace: validated,
    },
    null,
    2,
  );
}

export async function parseBackup(text: string): Promise<Workspace> {
  if (text.length > 250_000_000)
    return invalid("ファイルが250 MBを超えています。");
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    return invalid("JSONとして読み込めません。");
  }
  if (
    !isObject(envelope) ||
    envelope.format !== "folio-backup" ||
    envelope.version !== 1 ||
    !isString(envelope.checksum, 64) ||
    !/^[\da-f]{64}$/.test(envelope.checksum)
  )
    return invalid("Folioのバックアップファイルを選んでください。");
  const workspace = validateWorkspace(envelope.workspace);
  if ((await checksum(workspace)) !== envelope.checksum)
    return invalid(
      "整合性チェックに失敗しました。ファイルが変更または破損しています。",
    );
  return workspace;
}

function download(content: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function downloadBackup(workspace: Workspace): Promise<void> {
  download(
    await createBackupText(workspace),
    `Folio-backup-${new Date().toISOString().slice(0, 10)}.json`,
    "application/json",
  );
}

function htmlToMarkdown(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = sanitizeHtml(html);
  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (!(node instanceof Element)) return "";
    const content = Array.from(node.childNodes).map(walk).join(""),
      tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag))
      return `${"#".repeat(Number(tag[1]))} ${content}\n\n`;
    if (["strong", "b"].includes(tag)) return `**${content}**`;
    if (["em", "i"].includes(tag)) return `*${content}*`;
    if (tag === "br") return "\n";
    if (tag === "pre")
      return `\n\n\`\`\`\n${node.textContent || ""}\n\`\`\`\n\n`;
    if (tag === "code") return `\`${content}\``;
    if (tag === "a") return `[${content}](${node.getAttribute("href") || ""})`;
    if (tag === "img")
      return `![${node.getAttribute("alt") || ""}](${node.getAttribute("src") || ""})`;
    if (tag === "li")
      return `${node.parentElement?.tagName === "OL" ? `${Array.from(node.parentElement.children).indexOf(node) + 1}.` : "-"} ${content.trim()}\n`;
    if (tag === "blockquote")
      return (
        content
          .trim()
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n") + "\n\n"
      );
    // Keeping a table/layout as sanitized HTML avoids a lossy Markdown conversion.
    if (
      ["table", "svg", "math"].includes(tag) ||
      (tag === "div" && node.hasAttribute("style"))
    )
      return node.outerHTML + "\n\n";
    return ["p", "div", "section", "ul", "ol"].includes(tag)
      ? `${content}\n\n`
      : content;
  }
  return Array.from(container.childNodes)
    .map(walk)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function downloadNote(
  note: Note,
  format: "html" | "markdown" | "json",
): void {
  const name = (note.title || "無題のノート")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .slice(0, 100);
  if (format === "json")
    download(
      JSON.stringify({ format: "folio-note", version: 1, note }, null, 2),
      `${name}.json`,
      "application/json",
    );
  else if (format === "markdown")
    download(
      `# ${note.title}\n\n${note.blocks.map((b) => (b.type === "math" ? `$$\n${b.html || ""}\n$$` : htmlToMarkdown(blocksToHtml([b])))).join("\n\n")}`,
      `${name}.md`,
      "text/markdown;charset=utf-8",
    );
  else
    download(
      `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(note.title)}</title><style>body{max-width:860px;margin:40px auto;padding:20px;font:16px/1.8 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#262626}img,svg{max-width:100%;height:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:10px}pre{white-space:pre-wrap;background:#f5f5f5;padding:18px;border-radius:10px}blockquote{border-left:3px solid #bbb;margin-left:0;padding-left:20px}figure{margin:24px 0}math{font-size:1.2em}.katex-html{display:none}</style><body><h1>${escapeHtml(note.title)}</h1>${blocksToHtml(note.blocks)}</body></html>`,
      `${name}.html`,
      "text/html;charset=utf-8",
    );
}
