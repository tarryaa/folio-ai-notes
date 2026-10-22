import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  ClipboardEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  ReactNode,
} from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Bold,
  Check,
  CheckSquare,
  ChevronDown,
  Clipboard,
  Code2,
  Copy,
  CornerDownLeft,
  FileText,
  GripVertical,
  Heading2,
  ImagePlus,
  Italic,
  Link,
  List,
  ListOrdered,
  Maximize2,
  MessageSquarePlus,
  Minus,
  MoreHorizontal,
  MoveRight,
  Plus,
  Redo2,
  RotateCcw,
  Scissors,
  Sigma,
  Table2,
  Trash2,
  Underline,
  Undo2,
  X,
} from "lucide-react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type {
  Annotation,
  Block,
  BlockType,
  Note,
  Original,
} from "../core/types";
import { uid } from "../core/types";
import {
  copyBlocks,
  filesToContent,
  htmlToBlocks,
  sanitizeHtml,
  textToBlocks,
} from "../core/import";
import "./editor.css";

export interface EditorProps {
  note: Note;
  onChange: (blocks: Block[]) => void;
  onNotify: (message: string) => void;
  onMoveBlocks?: (blocks: Block[], ids: string[]) => void;
  onCaptureOriginals?: (originals: Original[]) => void;
}

const clone = (blocks: Block[]) => structuredClone(blocks);
const emptyBlock = (): Block => ({
  id: uid(),
  type: "text",
  html: "<p><br></p>",
});
const blockLabels: Record<BlockType, string> = {
  text: "テキスト",
  heading: "見出し",
  image: "画像",
  table: "表",
  code: "コード",
  quote: "引用",
  divider: "区切り線",
  math: "数式",
  html: "リッチコンテンツ",
};
const richTypes: BlockType[] = ["text", "heading", "table", "quote", "html"];
// Comparing the image strings by reference/value avoids serializing every embedded
// image after each keystroke. Only the edited block needs a new object.
const equalBlocks = (left: Block[], right: Block[]) =>
  left.length === right.length &&
  left.every((block, index) => {
    const other = right[index];
    if (block === other) return true;
    if (
      block.id !== other.id ||
      block.type !== other.type ||
      block.html !== other.html ||
      block.src !== other.src ||
      block.name !== other.name ||
      block.width !== other.width ||
      block.caption !== other.caption
    )
      return false;
    const annotations = block.annotations || [],
      otherAnnotations = other.annotations || [];
    return (
      annotations.length === otherAnnotations.length &&
      annotations.every((annotation, annotationIndex) => {
        const otherAnnotation = otherAnnotations[annotationIndex];
        return (
          annotation.id === otherAnnotation.id &&
          annotation.x === otherAnnotation.x &&
          annotation.y === otherAnnotation.y &&
          annotation.text === otherAnnotation.text
        );
      })
    );
  });

interface RichContentProps {
  block: Block;
  onInput: (id: string, html: string) => void;
  onFocus: (id: string) => void;
  onRemember: () => void;
  onPaste: (event: ClipboardEvent<HTMLDivElement>, id: string) => void;
  register: (id: string, element: HTMLDivElement | null) => void;
}

// React does not own the editable DOM. This keeps native selection and IME composition
// intact while the surrounding note auto-saves after every committed input.
const RichContent = memo(function RichContent({
  block,
  onInput,
  onFocus,
  onRemember,
  onPaste,
  register,
}: RichContentProps) {
  const element = useRef<HTMLDivElement | null>(null);
  const composing = useRef(false);
  useLayoutEffect(() => {
    const node = element.current;
    if (
      node &&
      node.innerHTML !== (block.html || "") &&
      document.activeElement !== node &&
      !composing.current
    )
      node.innerHTML = sanitizeHtml(block.html || "");
  }, [block.html]);
  return (
    <div
      ref={(node) => {
        element.current = node;
        register(block.id, node);
      }}
      className={`rich-content rich-${block.type}`}
      role="textbox"
      aria-label={`${blockLabels[block.type]}を編集`}
      aria-multiline="true"
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-placeholder="入力するか、ChatGPTの回答を貼り付け…"
      onFocus={() => onFocus(block.id)}
      onInput={(event) => {
        if (!composing.current)
          onInput(block.id, event.currentTarget.innerHTML);
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        onInput(block.id, event.currentTarget.innerHTML);
        onRemember();
      }}
      onKeyUp={onRemember}
      onPointerUp={onRemember}
      onPaste={(event) => onPaste(event, block.id)}
    />
  );
});

export function ImageLightbox({
  src,
  name,
  onClose,
}: {
  src: string;
  name?: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(100);
  const [naturalWidth, setNaturalWidth] = useState<number | null>(null);
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [onClose]);
  return createPortal(
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="原寸画像の確認"
    >
      <div className="lightbox-top">
        <span>{name || "原本画像"}</span>
        <label>
          表示倍率{" "}
          <select
            aria-label="画像の表示倍率"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          >
            {[25, 50, 75, 100, 150, 200, 300].map((value) => (
              <option key={value} value={value}>
                {value}%
              </option>
            ))}
          </select>
        </label>
        <button
          className="ed-icon"
          aria-label="拡大表示を閉じる"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="lightbox-scroll">
        <img
          src={src}
          alt={name || "原本画像"}
          onLoad={(event) => setNaturalWidth(event.currentTarget.naturalWidth)}
          style={{
            maxWidth: "none",
            width: naturalWidth ? `${(naturalWidth * zoom) / 100}px` : "auto",
          }}
          draggable={false}
        />
      </div>
      <div className="lightbox-foot">
        保存した画像データをそのまま表示しています。スクロールで細部を確認できます。
      </div>
    </div>,
    document.body,
  );
}

function ImageBlock({
  block,
  onChange,
  onZoom,
}: {
  block: Block;
  onChange: (patch: Partial<Block>, group?: string) => void;
  onZoom: () => void;
}) {
  const [annotating, setAnnotating] = useState(false);
  const annotations = block.annotations || [];
  const updateAnnotation = (id: string, patch: Partial<Annotation>) =>
    onChange(
      {
        annotations: annotations.map((annotation) =>
          annotation.id === id ? { ...annotation, ...patch } : annotation,
        ),
      },
      `annotation:${id}`,
    );
  return (
    <figure className="image-block">
      <div
        className={`image-stage ${annotating ? "is-annotating" : ""}`}
        style={{ width: `${block.width ?? 100}%` }}
        onClick={(event) => {
          if (
            !annotating ||
            (event.target as HTMLElement).closest(".image-annotation")
          )
            return;
          const bounds = event.currentTarget.getBoundingClientRect();
          onChange({
            annotations: [
              ...annotations,
              {
                id: uid(),
                x: Math.min(
                  0.85,
                  Math.max(0, (event.clientX - bounds.left) / bounds.width),
                ),
                y: Math.min(
                  0.95,
                  Math.max(0, (event.clientY - bounds.top) / bounds.height),
                ),
                text: "注釈",
              },
            ],
          });
        }}
      >
        <img
          src={block.src}
          alt={block.caption || block.name || "保存した画像"}
          draggable={false}
          onDoubleClick={() => {
            if (!annotating) onZoom();
          }}
        />
        {annotations.map((annotation, index) => (
          <div
            key={annotation.id}
            className="image-annotation"
            style={{
              left: `${annotation.x * 100}%`,
              top: `${annotation.y * 100}%`,
            }}
          >
            <span className="annotation-number">{index + 1}</span>
            {annotating ? (
              <div className="annotation-edit">
                <textarea
                  autoFocus
                  aria-label={`注釈${index + 1}`}
                  value={annotation.text}
                  onChange={(event) =>
                    updateAnnotation(annotation.id, {
                      text: event.target.value,
                    })
                  }
                />
                <button
                  aria-label="注釈を削除"
                  onClick={() =>
                    onChange({
                      annotations: annotations.filter(
                        (item) => item.id !== annotation.id,
                      ),
                    })
                  }
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <span className="annotation-text">{annotation.text}</span>
            )}
          </div>
        ))}
      </div>
      <input
        className="image-caption"
        aria-label="画像のキャプション"
        placeholder="キャプションを追加"
        value={block.caption || ""}
        onChange={(event) =>
          onChange({ caption: event.target.value }, `caption:${block.id}`)
        }
      />
      <div className="image-controls">
        <label>
          幅{" "}
          <input
            type="range"
            min="20"
            max="100"
            value={block.width ?? 100}
            aria-label="画像の幅"
            onChange={(event) =>
              onChange(
                { width: Number(event.target.value) },
                `resize:${block.id}`,
              )
            }
          />
          <span>{block.width ?? 100}%</span>
        </label>
        <button
          className={annotating ? "ed-mini active" : "ed-mini"}
          onClick={() => setAnnotating(!annotating)}
        >
          <MessageSquarePlus size={14} />
          {annotating ? "注釈を完了" : "注釈"}
        </button>
        <button className="ed-mini" onClick={onZoom}>
          <Maximize2 size={14} />
          拡大
        </button>
        {(annotations.length > 0 ||
          block.width !== undefined ||
          block.caption) && (
          <button
            className="ed-mini"
            onClick={() => {
              onChange({ annotations: [], width: undefined, caption: "" });
              setAnnotating(false);
            }}
            title="注釈・サイズ・キャプションを戻す"
          >
            <RotateCcw size={14} />
            原本に戻す
          </button>
        )}
      </div>
      {annotating && (
        <p className="ed-hint">
          画像上をタップして注釈を追加。原本のピクセルは変更しません。
        </p>
      )}
    </figure>
  );
}

function MathBlock({
  block,
  onChange,
}: {
  block: Block;
  onChange: (value: string) => void;
}) {
  let html: string;
  try {
    html = katex.renderToString(block.html || "", {
      displayMode: true,
      throwOnError: false,
      trust: false,
      strict: "ignore",
    });
  } catch {
    html = "数式を表示できません。TeXソースを確認してください。";
  }
  return (
    <div className="math-block">
      <div
        className="math-preview"
        aria-label="数式プレビュー"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <label className="ed-source-label">
        TeX
        <textarea
          aria-label="数式のTeXソース"
          value={block.html || ""}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
        />
      </label>
    </div>
  );
}

function ToolButton({
  label,
  children,
  onClick,
  disabled,
  active,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`ed-icon ${active ? "active" : ""}`}
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export default function Editor({
  note,
  onChange,
  onNotify,
  onMoveBlocks,
  onCaptureOriginals,
}: EditorProps) {
  const [blocks, setBlocks] = useState<Block[]>(note.blocks);
  const current = useRef(blocks);
  const currentNote = useRef(note.id);
  const history = useRef<Block[][]>([clone(note.blocks)]);
  const historyPosition = useRef(0);
  const historyGroup = useRef({ key: "", at: 0 });
  const [, updateHistory] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [addMenu, setAddMenu] = useState(false);
  const [moreTools, setMoreTools] = useState(false);
  const [openBlockMenu, setOpenBlockMenu] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [zoomImage, setZoomImage] = useState<Block | null>(null);
  const [pasteDialog, setPasteDialog] = useState<"rich" | "plain" | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [linkDialog, setLinkDialog] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const [tableMenu, setTableMenu] = useState(false);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const imageInput = useRef<HTMLInputElement>(null);
  const savedRange = useRef<Range | null>(null);
  const plainPaste = useRef(false);
  const dragIds = useRef<string[]>([]);
  const shell = useRef<HTMLDivElement>(null);
  const emitted = useRef<Block[] | null>(null);
  const selectedBlocks = blocks.filter((block) => selected.has(block.id));
  const active = blocks.find((block) => block.id === activeId);

  useLayoutEffect(() => {
    if (currentNote.current !== note.id) {
      currentNote.current = note.id;
      current.current = note.blocks;
      setBlocks(note.blocks);
      history.current = [clone(note.blocks)];
      historyPosition.current = 0;
      historyGroup.current = { key: "", at: 0 };
      setSelected(new Set());
      setSelectMode(false);
      setActiveId(null);
      setOpenBlockMenu(null);
      setAddMenu(false);
      savedRange.current = null;
      emitted.current = null;
      updateHistory((value) => value + 1);
    } else if (
      note.blocks !== emitted.current &&
      note.blocks !== current.current &&
      !equalBlocks(note.blocks, current.current)
    ) {
      // A history restore, import, or API operation from the workspace is a new baseline.
      current.current = note.blocks;
      setBlocks(note.blocks);
      history.current = [clone(note.blocks)];
      historyPosition.current = 0;
      setSelected(new Set());
      updateHistory((value) => value + 1);
      for (const block of note.blocks) {
        const element = nodes.current.get(block.id);
        if (element && richTypes.includes(block.type))
          element.innerHTML = sanitizeHtml(block.html || "");
      }
    }
  }, [note.id, note.blocks]);

  const commit = useCallback(
    (next: Block[], group = "") => {
      if (equalBlocks(next, current.current)) return;
      const now = Date.now();
      const coalesce =
        group &&
        historyGroup.current.key === group &&
        now - historyGroup.current.at < 800 &&
        historyPosition.current === history.current.length - 1;
      history.current = history.current.slice(0, historyPosition.current + 1);
      if (coalesce && history.current.length > 1)
        history.current[historyPosition.current] = clone(next);
      else {
        history.current.push(clone(next));
        historyPosition.current++;
      }
      if (history.current.length > 150) {
        history.current.shift();
        historyPosition.current--;
      }
      historyGroup.current = { key: group, at: now };
      current.current = next;
      emitted.current = next;
      setBlocks(next);
      onChange(next);
      updateHistory((value) => value + 1);
    },
    [onChange],
  );

  const travel = useCallback(
    (direction: number) => {
      const position = historyPosition.current + direction;
      if (position < 0 || position >= history.current.length) return;
      historyPosition.current = position;
      historyGroup.current = { key: "", at: 0 };
      const next = clone(history.current[position]);
      current.current = next;
      emitted.current = next;
      setBlocks(next);
      onChange(next);
      setSelected(new Set());
      const focused = document.activeElement;
      let restoredFocus = false;
      for (const block of next) {
        const node = nodes.current.get(block.id);
        if (node && richTypes.includes(block.type)) {
          node.innerHTML = sanitizeHtml(block.html || "");
          if (node === focused) {
            const range = document.createRange();
            range.selectNodeContents(node);
            range.collapse(false);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            savedRange.current = range.cloneRange();
            restoredFocus = true;
          }
        }
      }
      if (!restoredFocus) savedRange.current = null;
      updateHistory((value) => value + 1);
    },
    [onChange],
  );

  const patchBlock = useCallback(
    (id: string, patch: Partial<Block>, group = "") =>
      commit(
        current.current.map((block) =>
          block.id === id ? { ...block, ...patch } : block,
        ),
        group,
      ),
    [commit],
  );
  const handleInput = useCallback(
    (id: string, html: string) =>
      patchBlock(id, { html: sanitizeHtml(html) }, `typing:${id}`),
    [patchBlock],
  );
  const register = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);
  const rememberSelection = useCallback(() => {
    const selection = window.getSelection();
    if (selection?.rangeCount && shell.current?.contains(selection.anchorNode))
      savedRange.current = selection.getRangeAt(0).cloneRange();
  }, []);
  useEffect(() => {
    document.addEventListener("selectionchange", rememberSelection);
    return () =>
      document.removeEventListener("selectionchange", rememberSelection);
  }, [rememberSelection]);

  const restoreSelection = () => {
    if (
      savedRange.current &&
      document.contains(savedRange.current.startContainer)
    ) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(savedRange.current);
      return true;
    }
    const node = activeId ? nodes.current.get(activeId) : undefined;
    if (node) {
      node.focus();
      return true;
    }
    onNotify("書式を変更する本文や表を先にタップしてください。");
    return false;
  };
  const flushActive = () => {
    const id = activeId;
    const node = id ? nodes.current.get(id) : undefined;
    if (node && id) handleInput(id, node.innerHTML);
    rememberSelection();
  };
  const format = (command: string, value?: string) => {
    if (!restoreSelection()) return;
    document.execCommand(command, false, value);
    flushActive();
  };
  const changeStyle = (property: string, value: string) => {
    if (!restoreSelection()) return;
    const range = window.getSelection()?.rangeCount
      ? window.getSelection()!.getRangeAt(0)
      : null;
    let element =
      range?.startContainer instanceof HTMLElement
        ? range.startContainer
        : range?.startContainer.parentElement;
    const root = activeId ? nodes.current.get(activeId) : undefined;
    if (!element || !root) return;
    const paragraph = element.closest(
      "p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,div",
    );
    if (paragraph && paragraph !== root && root.contains(paragraph))
      (paragraph as HTMLElement).style.setProperty(property, value);
    else {
      const wrapper = document.createElement("div");
      wrapper.style.setProperty(property, value);
      while (root.firstChild) wrapper.appendChild(root.firstChild);
      root.appendChild(wrapper);
    }
    flushActive();
  };
  const fontSize = (value: string) => {
    if (!value || !restoreSelection()) return;
    document.execCommand("fontSize", false, "7");
    const root = activeId ? nodes.current.get(activeId) : null;
    root?.querySelectorAll('font[size="7"]').forEach((font) => {
      const span = document.createElement("span");
      span.style.fontSize = `${value}px`;
      span.innerHTML = font.innerHTML;
      font.replaceWith(span);
    });
    flushActive();
  };

  const insertBlocks = useCallback(
    (incoming: Block[], afterId?: string | null) => {
      if (!incoming.length) return;
      const existing = current.current;
      const position = afterId
        ? existing.findIndex((block) => block.id === afterId)
        : existing.length - 1;
      const next = [...existing];
      const target = existing[position];
      const targetNode = target && nodes.current.get(target.id);
      const isEmpty =
        target &&
        richTypes.includes(target.type) &&
        !(
          targetNode?.textContent || (target.html || "").replace(/<[^>]+>/g, "")
        ).trim() &&
        !target.html?.includes("<img");
      next.splice(
        position < 0 ? next.length : position + (isEmpty ? 0 : 1),
        isEmpty ? 1 : 0,
        ...incoming.map((block) => ({ ...block, id: uid() })),
      );
      commit(next);
      setAddMenu(false);
    },
    [commit],
  );

  const pasteContent = useCallback(
    async (
      html: string,
      text: string,
      files: File[],
      id?: string | null,
      forcePlain = false,
    ) => {
      const targetNote = currentNote.current;
      try {
        if (files.length) {
          const result = await filesToContent(files, "editable");
          if (targetNote !== currentNote.current) {
            onNotify(
              "取り込み中にノートを切り替えたため、追加を中止しました。元のノートでもう一度お試しください。",
            );
            return;
          }
          // Clipboard image files can accompany rich HTML and plain text in the
          // same paste. Keep those representations together instead of treating
          // a file as a replacement for the accompanying answer.
          let accompanying =
            !forcePlain && html ? htmlToBlocks(html) : textToBlocks(text);
          if (!accompanying.length && text) accompanying = textToBlocks(text);
          const accompanyingOriginals: Original[] = [];
          const capturedAt = new Date().toISOString();
          if (html)
            accompanyingOriginals.push({
              kind: "html",
              content: html,
              capturedAt,
              name: "クリップボードのHTML原本",
            });
          if (text)
            accompanyingOriginals.push({
              kind: "text",
              content: text,
              capturedAt,
              name: "クリップボードのテキスト原本",
            });
          insertBlocks([...accompanying, ...result.blocks], id);
          onCaptureOriginals?.([...accompanyingOriginals, ...result.originals]);
          result.warnings.forEach(onNotify);
          if (/<img\b/i.test(html) && result.blocks.some((block) => block.type === "image"))
            onNotify("文章と画像を両方保存しました。元のHTMLにも画像が含まれるため、画像が重複する場合があります。");
          return;
        }
        if (!html && !text) {
          onNotify("貼り付けできる内容がありません。");
          return;
        }
        const incoming =
          !forcePlain && html ? htmlToBlocks(html) : textToBlocks(text);
        onCaptureOriginals?.([
          {
            kind: !forcePlain && html ? "html" : "text",
            content: !forcePlain && html ? html : text,
            capturedAt: new Date().toISOString(),
            name: "クリップボードから保存",
          },
        ]);
        if (
          id &&
          incoming.length === 1 &&
          incoming[0].type === "text" &&
          nodes.current.has(id)
        ) {
          const node = nodes.current.get(id)!;
          node.focus();
          if (
            savedRange.current &&
            document.contains(savedRange.current.startContainer)
          ) {
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(savedRange.current);
          }
          if (!forcePlain && html)
            document.execCommand("insertHTML", false, sanitizeHtml(html));
          else document.execCommand("insertText", false, text);
          handleInput(id, node.innerHTML);
          rememberSelection();
        } else insertBlocks(incoming, id);
      } catch (error) {
        onNotify(
          `貼り付けに失敗しました。${error instanceof Error ? error.message : "別の形式またはファイル取り込みをお試しください。"}`,
        );
      }
    },
    [
      handleInput,
      insertBlocks,
      onCaptureOriginals,
      onNotify,
      rememberSelection,
    ],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>, id: string) => {
      event.preventDefault();
      rememberSelection();
      const data = event.clipboardData;
      void pasteContent(
        data.getData("text/html"),
        data.getData("text/plain"),
        [...data.files],
        id,
        plainPaste.current,
      );
      plainPaste.current = false;
    },
    [pasteContent, rememberSelection],
  );

  const readClipboard = async (plain: boolean) => {
    const targetNote = currentNote.current;
    rememberSelection();
    try {
      if (!plain && navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        let html = "",
          text = "";
        const files: File[] = [];
        for (const item of items)
          for (const type of item.types) {
            const blob = await item.getType(type);
            if (type === "text/html") html += await blob.text();
            else if (type === "text/plain") text += await blob.text();
            else if (type.startsWith("image/"))
              files.push(
                new File([blob], `貼り付け画像.${type.split("/")[1]}`, {
                  type,
                }),
              );
          }
        if (targetNote !== currentNote.current) {
          onNotify("ノートを切り替えたため、貼り付けを中止しました。");
          return;
        }
        await pasteContent(html, text, files, activeId, false);
      } else if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (targetNote !== currentNote.current) {
          onNotify("ノートを切り替えたため、貼り付けを中止しました。");
          return;
        }
        await pasteContent("", text, [], activeId, plain);
      } else throw new Error("unavailable");
    } catch {
      if (targetNote === currentNote.current) {
        setPasteText("");
        setPasteDialog(plain ? "plain" : "rich");
      }
    }
  };

  const performCopy = async (items: Block[], cut = false) => {
    const targetNote = currentNote.current;
    try {
      await copyBlocks(items);
      if (cut && targetNote !== currentNote.current) {
        onNotify(
          "コピーしました。ノートを切り替えたため、元の内容は削除していません。",
        );
        return;
      }
      onNotify(
        `${items.length}ブロックを${cut ? "切り取り" : "コピー"}しました。`,
      );
      if (cut) {
        commit(
          current.current.filter(
            (block) => !items.some((item) => item.id === block.id),
          ),
        );
        setSelected(new Set());
      }
    } catch {
      onNotify(
        "コピーできませんでした。本文を長押しして選択し、端末の「コピー」をお使いください。",
      );
    }
  };
  const remove = (ids: string[]) => {
    commit(current.current.filter((block) => !ids.includes(block.id)));
    setSelected(new Set());
    setOpenBlockMenu(null);
  };
  const duplicate = (ids: string[]) => {
    const next = current.current.flatMap((block) =>
      ids.includes(block.id)
        ? [block, { ...structuredClone(block), id: uid() }]
        : [block],
    );
    commit(next);
    setOpenBlockMenu(null);
    onNotify(`${ids.length}ブロックを複製しました。`);
  };
  const move = (ids: string[], direction: number) => {
    const idSet = new Set(ids);
    const next = [...current.current];
    if (direction < 0)
      for (let index = 1; index < next.length; index++) {
        if (idSet.has(next[index].id) && !idSet.has(next[index - 1].id))
          [next[index - 1], next[index]] = [next[index], next[index - 1]];
      }
    else
      for (let index = next.length - 2; index >= 0; index--) {
        if (idSet.has(next[index].id) && !idSet.has(next[index + 1].id))
          [next[index], next[index + 1]] = [next[index + 1], next[index]];
      }
    commit(next);
  };
  const add = (type: BlockType) => {
    const defaults: Partial<Record<BlockType, string>> = {
      text: "<p><br></p>",
      heading: "<h2>見出し</h2>",
      quote: "<blockquote>引用を入力</blockquote>",
      code: "// コードを入力",
      math: "E = mc^2",
      table:
        "<table><thead><tr><th>項目</th><th>内容</th></tr></thead><tbody><tr><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td></tr></tbody></table>",
    };
    if (type === "image") {
      imageInput.current?.click();
      setAddMenu(false);
      return;
    }
    const block: Block = { id: uid(), type, html: defaults[type] || "" };
    const existing = current.current;
    const position = activeId
      ? existing.findIndex((item) => item.id === activeId) + 1
      : existing.length;
    commit([
      ...existing.slice(0, position),
      block,
      ...existing.slice(position),
    ]);
    setAddMenu(false);
    setActiveId(block.id);
    window.setTimeout(() => {
      nodes.current.get(block.id)?.focus();
    }, 30);
  };

  const editTable = (
    action:
      | "rowBefore"
      | "rowAfter"
      | "columnBefore"
      | "columnAfter"
      | "deleteRow"
      | "deleteColumn",
  ) => {
    if (!restoreSelection()) return;
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const element = anchor instanceof Element ? anchor : anchor?.parentElement;
    const cell = element?.closest("td, th") as HTMLTableCellElement | null;
    const row = cell?.parentElement as HTMLTableRowElement | null;
    const table = cell?.closest("table");
    if (!cell || !row || !table) {
      onNotify("操作する表のセルを先にタップしてください。");
      return;
    }
    const column = cell.cellIndex;
    if (action === "rowBefore" || action === "rowAfter") {
      const newRow = document.createElement("tr");
      for (const oldCell of [...row.cells]) {
        const newCell = document.createElement("td");
        newCell.innerHTML = "<br>";
        if (oldCell.colSpan > 1) newCell.colSpan = oldCell.colSpan;
        newRow.appendChild(newCell);
      }
      row.insertAdjacentElement(
        action === "rowBefore" ? "beforebegin" : "afterend",
        newRow,
      );
    } else if (action === "columnBefore" || action === "columnAfter") {
      for (const tableRow of [...table.rows]) {
        const reference = tableRow.cells[column];
        const newCell = document.createElement(
          reference?.tagName.toLowerCase() || "td",
        );
        newCell.innerHTML = "<br>";
        if (reference)
          reference.insertAdjacentElement(
            action === "columnBefore" ? "beforebegin" : "afterend",
            newCell,
          );
        else tableRow.appendChild(newCell);
      }
    } else if (action === "deleteRow") {
      if (table.rows.length <= 1) {
        onNotify("最後の行は削除できません。表ブロック全体を削除できます。");
        return;
      }
      row.remove();
    } else {
      if ([...table.rows].some((tableRow) => tableRow.cells.length <= 1)) {
        onNotify("最後の列は削除できません。");
        return;
      }
      for (const tableRow of [...table.rows]) tableRow.cells[column]?.remove();
    }
    flushActive();
    setTableMenu(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if ((event.target as HTMLElement).closest(".ed-dialog")) {
      if (event.key === "Escape") {
        setPasteDialog(null);
        setLinkDialog(false);
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v")
      plainPaste.current = event.shiftKey;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      travel(event.shiftKey ? 1 : -1);
    } else if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "y"
    ) {
      event.preventDefault();
      travel(1);
    } else if (event.key === "Escape") {
      setSelected(new Set());
      setSelectMode(false);
      setOpenBlockMenu(null);
      setAddMenu(false);
    } else if (
      (event.key === "Delete" || event.key === "Backspace") &&
      selectMode &&
      selected.size &&
      !(event.target as HTMLElement).closest("input,textarea,[contenteditable]")
    ) {
      event.preventDefault();
      remove([...selected]);
    } else if (event.key === "Tab") {
      const anchor = window.getSelection()?.anchorNode;
      const element =
        anchor instanceof Element ? anchor : anchor?.parentElement;
      const cell = element?.closest("td,th");
      const table = cell?.closest("table");
      const cells = table ? [...table.querySelectorAll("td,th")] : [];
      const next = cells[cells.indexOf(cell!) + (event.shiftKey ? -1 : 1)];
      if (next) {
        event.preventDefault();
        const range = document.createRange();
        range.selectNodeContents(next);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        rememberSelection();
      }
    }
  };
  const onDrop = (event: DragEvent<HTMLElement>, targetId?: string) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(null);
    if (event.dataTransfer.files.length) {
      void pasteContent("", "", [...event.dataTransfer.files], targetId);
      return;
    }
    const ids = dragIds.current;
    if (!ids.length || (targetId && ids.includes(targetId))) return;
    const moving = current.current.filter((block) => ids.includes(block.id));
    const remaining = current.current.filter(
      (block) => !ids.includes(block.id),
    );
    const targetPosition = targetId
      ? remaining.findIndex((block) => block.id === targetId)
      : remaining.length;
    remaining.splice(
      targetPosition < 0 ? remaining.length : targetPosition,
      0,
      ...moving,
    );
    commit(remaining);
    dragIds.current = [];
  };

  const sourceCharacterCount = blocks.reduce(
    (count, block) =>
      count +
      (block.type === "code" || block.type === "math"
        ? block.html?.length || 0
        : (block.html || "").replace(/<[^>]*>/g, "").length),
    0,
  );

  return (
    <div className="block-editor" ref={shell} onKeyDown={onKeyDown}>
      <div
        className="editor-toolbar"
        role="toolbar"
        aria-label="ノートの書式設定"
      >
        <div className="ed-toolbar-group">
          <ToolButton
            label="元に戻す (Ctrl+Z)"
            onClick={() => travel(-1)}
            disabled={historyPosition.current === 0}
          >
            <Undo2 size={17} />
          </ToolButton>
          <ToolButton
            label="やり直す (Ctrl+Shift+Z)"
            onClick={() => travel(1)}
            disabled={historyPosition.current >= history.current.length - 1}
          >
            <Redo2 size={17} />
          </ToolButton>
        </div>
        <div className="ed-toolbar-group">
          <select
            aria-label="段落の種類"
            className="ed-select paragraph-select"
            defaultValue="p"
            onChange={(event) => {
              format("formatBlock", event.target.value);
              if (
                activeId &&
                active &&
                richTypes.includes(active.type) &&
                active.type !== "table" &&
                active.type !== "html"
              )
                patchBlock(activeId, {
                  type: event.target.value.startsWith("h")
                    ? "heading"
                    : event.target.value === "blockquote"
                      ? "quote"
                      : "text",
                });
            }}
          >
            <option value="p">本文</option>
            <option value="h1">大見出し</option>
            <option value="h2">見出し</option>
            <option value="h3">小見出し</option>
            <option value="blockquote">引用</option>
          </select>
          <ToolButton label="太字" onClick={() => format("bold")}>
            <Bold size={17} />
          </ToolButton>
          <ToolButton label="斜体" onClick={() => format("italic")}>
            <Italic size={17} />
          </ToolButton>
          <ToolButton label="下線" onClick={() => format("underline")}>
            <Underline size={17} />
          </ToolButton>
          <label className="ed-color" title="文字色">
            <span>A</span>
            <input
              type="color"
              aria-label="文字色"
              defaultValue="#28745e"
              onChange={(event) => format("foreColor", event.target.value)}
            />
          </label>
        </div>
        <div className="ed-toolbar-group ed-desktop-tools">
          <ToolButton
            label="箇条書き"
            onClick={() => format("insertUnorderedList")}
          >
            <List size={18} />
          </ToolButton>
          <ToolButton
            label="番号付きリスト"
            onClick={() => format("insertOrderedList")}
          >
            <ListOrdered size={18} />
          </ToolButton>
          <ToolButton
            label="リンクを挿入"
            onClick={() => {
              rememberSelection();
              setLinkUrl("https://");
              setLinkDialog(true);
            }}
          >
            <Link size={16} />
          </ToolButton>
        </div>
        <div className="ed-toolbar-group">
          <ToolButton
            label="その他の書式"
            active={moreTools}
            onClick={() => setMoreTools(!moreTools)}
          >
            <MoreHorizontal size={19} />
          </ToolButton>
          <ToolButton
            label={selectMode ? "選択モードを終了" : "ブロックを選択"}
            active={selectMode}
            onClick={() => {
              setSelectMode(!selectMode);
              setSelected(new Set());
            }}
          >
            <CheckSquare size={17} />
          </ToolButton>
        </div>
        <div className="ed-toolbar-end">
          <button
            className="ed-paste"
            aria-label="クリップボードから貼り付け"
            title="クリップボードから貼り付け"
            onClick={() => void readClipboard(false)}
          >
            <Clipboard size={15} />
            <span>貼り付け</span>
          </button>
          <div className="ed-add-wrap">
            <button
              className="ed-add"
              onClick={() => setAddMenu(!addMenu)}
              aria-expanded={addMenu}
            >
              <Plus size={16} />
              <span>追加</span>
              <ChevronDown size={12} />
            </button>
            {addMenu && (
              <div className="ed-menu add-menu">
                {(
                  [
                    { type: "text", icon: <FileText size={16} /> },
                    { type: "heading", icon: <Heading2 size={16} /> },
                    { type: "table", icon: <Table2 size={16} /> },
                    { type: "image", icon: <ImagePlus size={16} /> },
                    { type: "quote", icon: <CornerDownLeft size={16} /> },
                    { type: "code", icon: <Code2 size={16} /> },
                    { type: "math", icon: <Sigma size={16} /> },
                    { type: "divider", icon: <Minus size={16} /> },
                  ] as { type: BlockType; icon: ReactNode }[]
                ).map((item) => (
                  <button key={item.type} onClick={() => add(item.type)}>
                    {item.icon}
                    {blockLabels[item.type]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {moreTools && (
        <div
          className="editor-extra-toolbar"
          role="toolbar"
          aria-label="追加の書式設定"
        >
          <label className="ed-compact-paragraph">
            段落{" "}
            <select
              aria-label="段落の種類（詳細）"
              defaultValue="p"
              onChange={(event) => format("formatBlock", event.target.value)}
            >
              <option value="p">本文</option>
              <option value="h1">大見出し</option>
              <option value="h2">見出し</option>
              <option value="h3">小見出し</option>
              <option value="blockquote">引用</option>
            </select>
            <input
              type="color"
              aria-label="文字色（詳細）"
              defaultValue="#28745e"
              onChange={(event) => format("foreColor", event.target.value)}
            />
          </label>
          <label>
            文字サイズ{" "}
            <select
              aria-label="文字サイズ"
              defaultValue=""
              onChange={(event) => fontSize(event.target.value)}
            >
              <option value="" disabled>
                選択
              </option>
              {[12, 14, 16, 18, 20, 24, 28, 32].map((size) => (
                <option key={size} value={size}>
                  {size}px
                </option>
              ))}
            </select>
          </label>
          <ToolButton label="左揃え" onClick={() => format("justifyLeft")}>
            <AlignLeft size={17} />
          </ToolButton>
          <ToolButton label="中央揃え" onClick={() => format("justifyCenter")}>
            <AlignCenter size={17} />
          </ToolButton>
          <ToolButton label="右揃え" onClick={() => format("justifyRight")}>
            <AlignRight size={17} />
          </ToolButton>
          <label>
            行間{" "}
            <select
              aria-label="行間"
              defaultValue="1.8"
              onChange={(event) =>
                changeStyle("line-height", event.target.value)
              }
            >
              {["1.3", "1.5", "1.8", "2", "2.5"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            段落間隔{" "}
            <select
              aria-label="段落間隔"
              defaultValue="12"
              onChange={(event) =>
                changeStyle("margin-bottom", `${event.target.value}px`)
              }
            >
              {[0, 8, 12, 20, 32].map((value) => (
                <option key={value} value={value}>
                  {value}px
                </option>
              ))}
            </select>
          </label>
          <div className="ed-table-wrap">
            <button
              className="ed-mini"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setTableMenu(!tableMenu)}
            >
              <Table2 size={15} />
              表を編集
              <ChevronDown size={12} />
            </button>
            {tableMenu && (
              <div className="ed-menu table-menu">
                {(
                  [
                    ["rowBefore", "上に行を挿入"],
                    ["rowAfter", "下に行を挿入"],
                    ["columnBefore", "左に列を挿入"],
                    ["columnAfter", "右に列を挿入"],
                    ["deleteRow", "行を削除"],
                    ["deleteColumn", "列を削除"],
                  ] as const
                ).map(([action, label]) => (
                  <button
                    key={action}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => editTable(action)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="ed-mini" onClick={() => void readClipboard(true)}>
            書式なしで貼り付け
          </button>
          <ToolButton
            label="書式をクリア"
            onClick={() => format("removeFormat")}
          >
            <RotateCcw size={15} />
          </ToolButton>
          <span className="ed-mobile-tools">
            <ToolButton
              label="箇条書き"
              onClick={() => format("insertUnorderedList")}
            >
              <List size={17} />
            </ToolButton>
            <ToolButton
              label="番号付きリスト"
              onClick={() => format("insertOrderedList")}
            >
              <ListOrdered size={17} />
            </ToolButton>
            <ToolButton
              label="リンクを挿入"
              onClick={() => {
                rememberSelection();
                setLinkDialog(true);
              }}
            >
              <Link size={16} />
            </ToolButton>
          </span>
        </div>
      )}

      {selectMode && (
        <div className="block-selection-bar">
          <label>
            <input
              type="checkbox"
              checked={blocks.length > 0 && selected.size === blocks.length}
              onChange={(event) =>
                setSelected(
                  event.target.checked
                    ? new Set(blocks.map((block) => block.id))
                    : new Set(),
                )
              }
            />
            {selected.size
              ? `${selected.size}個を選択`
              : "ブロックをタップして選択"}
          </label>
          {selected.size > 0 && (
            <div className="selection-actions">
              <ToolButton
                label="選択をコピー"
                onClick={() => void performCopy(selectedBlocks)}
              >
                <Copy size={16} />
              </ToolButton>
              <ToolButton
                label="選択を切り取り"
                onClick={() => void performCopy(selectedBlocks, true)}
              >
                <Scissors size={16} />
              </ToolButton>
              <ToolButton
                label="選択を複製"
                onClick={() => duplicate([...selected])}
              >
                <Plus size={16} />
              </ToolButton>
              <ToolButton
                label="選択を上へ移動"
                onClick={() => move([...selected], -1)}
              >
                <ArrowUp size={16} />
              </ToolButton>
              <ToolButton
                label="選択を下へ移動"
                onClick={() => move([...selected], 1)}
              >
                <ArrowDown size={16} />
              </ToolButton>
              {onMoveBlocks && (
                <ToolButton
                  label="別のノートへ移動"
                  onClick={() => onMoveBlocks(selectedBlocks, [...selected])}
                >
                  <MoveRight size={16} />
                </ToolButton>
              )}
              <ToolButton
                label="選択を削除"
                onClick={() => remove([...selected])}
              >
                <Trash2 size={16} />
              </ToolButton>
            </div>
          )}
          <button
            className="ed-mini"
            onClick={() => {
              setSelectMode(false);
              setSelected(new Set());
            }}
          >
            完了
          </button>
        </div>
      )}

      <div
        className="editor-blocks"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => onDrop(event)}
      >
        {blocks.length === 0 && (
          <button
            className="editor-empty"
            onClick={() => {
              const block = emptyBlock();
              commit([block]);
              setActiveId(block.id);
              window.setTimeout(() => nodes.current.get(block.id)?.focus(), 30);
            }}
          >
            <Plus size={21} />
            <span>ここから、あなたのノートを。</span>
            <small>
              タップして入力するか、回答や画像を貼り付けてください。
            </small>
          </button>
        )}
        {blocks.map((block, index) => (
          <section
            key={block.id}
            data-block-id={block.id}
            className={`editor-block ${selected.has(block.id) ? "is-selected" : ""} ${dragOver === block.id ? "is-drag-over" : ""} ${selectMode ? "selection-mode" : ""} ${activeId === block.id ? "is-focused" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragOver(block.id);
            }}
            onDrop={(event) => onDrop(event, block.id)}
            onClick={(event) => {
              if (
                selectMode &&
                !(event.target as HTMLElement).closest("button,input,textarea")
              ) {
                setSelected((previous) => {
                  const next = new Set(previous);
                  if (next.has(block.id)) next.delete(block.id);
                  else next.add(block.id);
                  return next;
                });
              }
            }}
          >
            <div className="block-gutter">
              {selectMode ? (
                <input
                  type="checkbox"
                  aria-label={`${index + 1}番目のブロックを選択`}
                  checked={selected.has(block.id)}
                  onChange={(event) =>
                    setSelected((previous) => {
                      const next = new Set(previous);
                      if (event.target.checked) next.add(block.id);
                      else next.delete(block.id);
                      return next;
                    })
                  }
                />
              ) : (
                <button
                  className="block-drag ed-icon"
                  aria-label={`${index + 1}番目のブロックをドラッグして移動`}
                  draggable
                  onDragStart={(event) => {
                    dragIds.current = selected.has(block.id)
                      ? [...selected]
                      : [block.id];
                    event.dataTransfer.setData(
                      "application/x-folio-blocks",
                      dragIds.current.join(","),
                    );
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    dragIds.current = [];
                    setDragOver(null);
                  }}
                >
                  <GripVertical size={17} />
                </button>
              )}
            </div>
            <div
              className="block-body"
              style={selectMode ? { pointerEvents: "none" } : undefined}
            >
              {richTypes.includes(block.type) && (
                <RichContent
                  block={block}
                  onInput={handleInput}
                  onFocus={setActiveId}
                  onRemember={rememberSelection}
                  onPaste={handlePaste}
                  register={register}
                />
              )}
              {block.type === "image" && (
                <ImageBlock
                  block={block}
                  onChange={(patch, group) =>
                    patchBlock(block.id, patch, group)
                  }
                  onZoom={() => setZoomImage(block)}
                />
              )}
              {block.type === "divider" && <hr className="block-divider" />}
              {block.type === "code" && (
                <div className="code-block">
                  <div className="code-block-top">
                    <Code2 size={13} />
                    <span>コード</span>
                    <button
                      aria-label="コードをコピー"
                      onClick={() => {
                        if (!navigator.clipboard?.writeText) {
                          onNotify(
                            "コピーできませんでした。コードを選択してコピーしてください。",
                          );
                          return;
                        }
                        void navigator.clipboard
                          .writeText(block.html || "")
                          .then(() => onNotify("コードをコピーしました。"))
                          .catch(() =>
                            onNotify(
                              "コピーできませんでした。コードを選択してコピーしてください。",
                            ),
                          );
                      }}
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                  <textarea
                    aria-label="コードを編集"
                    value={block.html || ""}
                    onFocus={() => setActiveId(block.id)}
                    onChange={(event) =>
                      patchBlock(
                        block.id,
                        { html: event.target.value },
                        `typing:${block.id}`,
                      )
                    }
                    spellCheck={false}
                    rows={Math.min(
                      25,
                      Math.max(3, (block.html || "").split("\n").length),
                    )}
                  />
                </div>
              )}
              {block.type === "math" && (
                <MathBlock
                  block={block}
                  onChange={(value) =>
                    patchBlock(block.id, { html: value }, `typing:${block.id}`)
                  }
                />
              )}
            </div>
            {!selectMode && (
              <div className="block-actions">
                <button
                  className="ed-icon block-more"
                  aria-label={`${index + 1}番目のブロックの操作`}
                  aria-expanded={openBlockMenu === block.id}
                  onClick={() =>
                    setOpenBlockMenu(
                      openBlockMenu === block.id ? null : block.id,
                    )
                  }
                >
                  <MoreHorizontal size={17} />
                </button>
                {openBlockMenu === block.id && (
                  <div className="ed-menu block-menu">
                    <span className="ed-menu-label">
                      {blockLabels[block.type]}
                    </span>
                    <button
                      onClick={() => {
                        setSelectMode(true);
                        setSelected(new Set([block.id]));
                        setOpenBlockMenu(null);
                      }}
                    >
                      <CheckSquare size={15} />
                      選択
                    </button>
                    <button
                      onClick={() => {
                        void performCopy([block]);
                        setOpenBlockMenu(null);
                      }}
                    >
                      <Copy size={15} />
                      コピー
                    </button>
                    <button
                      onClick={() => {
                        void performCopy([block], true);
                        setOpenBlockMenu(null);
                      }}
                    >
                      <Scissors size={15} />
                      切り取り
                    </button>
                    <button onClick={() => duplicate([block.id])}>
                      <Plus size={15} />
                      複製
                    </button>
                    <button
                      disabled={index === 0}
                      onClick={() => move([block.id], -1)}
                    >
                      <ArrowUp size={15} />
                      上へ移動
                    </button>
                    <button
                      disabled={index === blocks.length - 1}
                      onClick={() => move([block.id], 1)}
                    >
                      <ArrowDown size={15} />
                      下へ移動
                    </button>
                    {onMoveBlocks && (
                      <button
                        onClick={() => {
                          onMoveBlocks([block], [block.id]);
                          setOpenBlockMenu(null);
                        }}
                      >
                        <MoveRight size={15} />
                        別のノートへ移動
                      </button>
                    )}
                    <button
                      className="danger"
                      onClick={() => remove([block.id])}
                    >
                      <Trash2 size={15} />
                      削除
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        ))}
        {blocks.length > 0 && (
          <button
            className="add-bottom-block"
            onClick={() => {
              const block = emptyBlock();
              commit([...current.current, block]);
              setActiveId(block.id);
              window.setTimeout(() => nodes.current.get(block.id)?.focus(), 30);
            }}
          >
            <Plus size={15} />
            テキストを追加
          </button>
        )}
      </div>
      <footer className="editor-foot">
        <span>
          {blocks.length} ブロック<span className="foot-dot">·</span>
          {sourceCharacterCount.toLocaleString()} 文字
        </span>
        <span>原本を残して、自由に編集。</span>
      </footer>
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        className="visually-hidden"
        aria-label="画像を追加"
        onChange={(event) => {
          const files = [...(event.target.files || [])];
          void pasteContent("", "", files, activeId);
          event.target.value = "";
        }}
      />
      {zoomImage?.src && (
        <ImageLightbox
          src={zoomImage.src}
          name={zoomImage.name}
          onClose={() => setZoomImage(null)}
        />
      )}
      {pasteDialog &&
        createPortal(
          <div
            className="ed-dialog-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setPasteDialog(null);
            }}
          >
            <form
              className="ed-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="内容を貼り付け"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void pasteContent("", pasteText, [], activeId, true);
                setPasteDialog(null);
              }}
            >
              <div className="ed-dialog-title">
                <h3>
                  {pasteDialog === "plain"
                    ? "書式なしで貼り付け"
                    : "内容を貼り付け"}
                </h3>
                <button
                  type="button"
                  className="ed-icon"
                  aria-label="閉じる"
                  onClick={() => setPasteDialog(null)}
                >
                  <X size={19} />
                </button>
              </div>
              <p>
                このブラウザでは直接の読み取りが制限されています。下の欄を長押しして「ペースト」、または
                Ctrl+V をお使いください。
              </p>
              <textarea
                autoFocus
                aria-label="ここに貼り付け"
                placeholder="ここに貼り付けてください"
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                onPaste={(event) => {
                  if (
                    pasteDialog === "rich" &&
                    (event.clipboardData.getData("text/html") ||
                      event.clipboardData.files.length)
                  ) {
                    event.preventDefault();
                    void pasteContent(
                      event.clipboardData.getData("text/html"),
                      event.clipboardData.getData("text/plain"),
                      [...event.clipboardData.files],
                      activeId,
                    );
                    setPasteDialog(null);
                  }
                }}
              />
              <button
                type="submit"
                className="ed-primary"
                disabled={!pasteText.trim()}
              >
                <Clipboard size={16} />
                ノートに追加
              </button>
            </form>
          </div>,
          document.body,
        )}
      {linkDialog &&
        createPortal(
          <div className="ed-dialog-backdrop">
            <form
              className="ed-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="リンクを挿入"
              onSubmit={(event) => {
                event.preventDefault();
                if (!/^(https?:|mailto:)/i.test(linkUrl)) {
                  onNotify(
                    "https:// または mailto: で始まるURLを入力してください。",
                  );
                  return;
                }
                format("createLink", linkUrl);
                setLinkDialog(false);
              }}
            >
              <div className="ed-dialog-title">
                <h3>リンクを挿入</h3>
                <button
                  type="button"
                  className="ed-icon"
                  aria-label="閉じる"
                  onClick={() => setLinkDialog(false)}
                >
                  <X size={19} />
                </button>
              </div>
              <p>先にリンクにしたい文字を選択してください。</p>
              <input
                autoFocus
                type="url"
                aria-label="リンク先URL"
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
              />
              <button type="submit" className="ed-primary">
                <Check size={16} />
                リンクを設定
              </button>
            </form>
          </div>,
          document.body,
        )}
    </div>
  );
}
