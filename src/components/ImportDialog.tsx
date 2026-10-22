import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import {
  Pencil,
  Image as ImageIcon,
  Check,
  Upload,
  FileText,
  X,
  ShieldCheck,
  RefreshCw,
  ArrowDownToLine,
} from "lucide-react";
import type { Block, Note, Original } from "../core/types";
import {
  htmlToBlocks,
  markdownToBlocks,
  textToBlocks,
  filesToContent,
  blocksToHtml,
  blocksToText,
} from "../core/import";
import Modal from "./Modal";

export interface ImportResult {
  title: string;
  blocks: Block[];
  originals: Original[];
  appendToId: string | null;
  importedNote?: Note;
}
interface ImportDialogProps {
  note: Note | null;
  onClose: () => void;
  onNotify: (message: string) => void;
  onImport: (result: ImportResult) => void;
}

export default function ImportDialog({
  note,
  onClose: close,
  onNotify: notify,
  onImport,
}: ImportDialogProps) {
  const [importMode, setImportMode] = useState<"editable" | "original">(
    "editable",
  );
  const [importText, setImportText] = useState("");
  const [importFormat, setImportFormat] = useState("markdown");
  const [importTitle, setImportTitle] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importAppend, setImportAppend] = useState(false);
  const [importRaw, setImportRaw] = useState<Original[]>([]);
  const [clipboardWarnings, setClipboardWarnings] = useState<string[]>([]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const importContent = async () => {
    if (importBusy || (!importText.trim() && !importFiles.length)) return;
    const appendToId = importAppend && note && !note.deletedAt ? note.id : null;
    setImportBusy(true);
    try {
      let blocks: Block[] = [],
        originals: Original[] = [...importRaw],
        warnings: string[] = [...clipboardWarnings],
        importedNote: Note | undefined;
      if (importText.trim()) {
        if (importMode === "original")
          throw new Error("原本保存では画像ファイルを選んでください。");
        blocks =
          importFormat === "html"
            ? htmlToBlocks(importText)
            : importFormat === "text"
              ? textToBlocks(importText)
              : markdownToBlocks(importText);
        if (!originals.length)
          originals.push({
            kind:
              importFormat === "html"
                ? "html"
                : importFormat === "text"
                  ? "text"
                  : "markdown",
            content: importText,
            capturedAt: new Date().toISOString(),
          });
      }
      if (importFiles.length) {
        const result = await filesToContent(importFiles, importMode);
        blocks.push(...result.blocks);
        originals.push(...result.originals);
        warnings.push(...result.warnings);
        if (!importText.trim()) importedNote = result.importedNote;
      }
      if (!blocks.length && !importedNote)
        throw new Error(
          "取り込める内容がありません。ファイル形式を確認してください。",
        );
      if (
        blocks.some(
          (block) =>
            /^https?:/i.test(block.src || "") ||
            /<img[^>]+src=["']https?:/i.test(block.html || ""),
        )
      )
        warnings.push(
          "外部画像は配信元と通信に依存します。確実に残す場合は画像ファイルも取り込んでください。",
        );
      // Closing the dialog while files are being read cancels this import.
      if (!mounted.current) return;
      onImport({
        title:
          importTitle.trim() ||
          importedNote?.title ||
          importFiles[0]?.name.replace(/\.[^.]+$/, "") ||
          "取り込んだ回答",
        blocks,
        originals,
        appendToId,
        importedNote,
      });
      close();
      notify(
        warnings.length
          ? "取り込みました。" + [...new Set(warnings)].join(" ")
          : "原本を保持して取り込みました",
      );
    } catch (error) {
      if (mounted.current) notify((error as Error).message);
    } finally {
      if (mounted.current) setImportBusy(false);
    }
  };
  const pasteImport = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    const html = event.clipboardData.getData("text/html");
    const plain = event.clipboardData.getData("text/plain");
    if (!files.length && !html && !plain) return;
    event.preventDefault();
    if (files.length) {
      setImportFiles((previous) => [...previous, ...files]);
    }
    const value = event.currentTarget.value;
    const before = value.slice(0, event.currentTarget.selectionStart);
    const after = value.slice(event.currentTarget.selectionEnd);
    if (html || plain) {
      setImportRaw((previous) => [
        ...previous,
        {
          kind: html ? "html" : "text",
          content: html || plain,
          capturedAt: new Date().toISOString(),
        },
      ]);
    }
    if (html && importFormat !== "text") {
      const preserveExisting = (text: string) =>
        importFormat === "html"
          ? text
          : blocksToHtml(
              importFormat === "markdown"
                ? markdownToBlocks(text)
                : textToBlocks(text),
            );
      setImportText(preserveExisting(before) + html + preserveExisting(after));
      setImportFormat("html");
    } else if (plain || html) {
      const incoming = plain || blocksToText(htmlToBlocks(html));
      setImportText(
        before +
          (importFormat === "html"
            ? blocksToHtml(textToBlocks(incoming))
            : incoming) +
          after,
      );
    }
    if (files.length && html) {
      setClipboardWarnings((previous) => [
        ...previous,
        "書式と画像ファイルを両方保持しました。同じ画像が重複する場合は、取り込み後に整理してください。",
      ]);
    }
  };
  return (
    <Modal title="回答を取り込む" onClose={close} wide>
      <p className="modal-intro">残したい回答を、使いやすいかたちで。</p>
      <div className="import-mode">
        <button
          className={importMode === "editable" ? "active" : ""}
          onClick={() => setImportMode("editable")}
        >
          <Pencil size={20} />
          <span>
            <strong>編集できる取り込み</strong>
            <small>文章・表・画像をブロックに</small>
          </span>
          {importMode === "editable" && <Check size={16} />}
        </button>
        <button
          className={importMode === "original" ? "active" : ""}
          onClick={() => {
            setImportMode("original");
            setImportText("");
          }}
        >
          <ImageIcon size={20} />
          <span>
            <strong>原本をそのまま保存</strong>
            <small>スクリーンショットの画質を保持</small>
          </span>
          {importMode === "original" && <Check size={16} />}
        </button>
      </div>
      <label className="field-label">
        ノートのタイトル
        <input
          value={importTitle}
          onChange={(e) => setImportTitle(e.target.value)}
          placeholder="取り込んだ回答"
        />
      </label>
      {importMode === "editable" && (
        <>
          <div className="input-heading">
            <label>回答を貼り付け</label>
            <select
              aria-label="取り込み形式"
              value={importFormat}
              onChange={(e) => {
                setImportFormat(e.target.value);
                setImportRaw([]);
              }}
            >
              <option value="markdown">Markdown・リッチテキスト</option>
              <option value="html">HTML</option>
              <option value="text">プレーンテキスト</option>
            </select>
          </div>
          <textarea
            className="import-text"
            value={importText}
            onChange={(e) => {
              setImportText(e.target.value);
              setImportRaw([]);
            }}
            onPaste={pasteImport}
            placeholder="ChatGPTの回答をコピーして、ここに貼り付け…"
            aria-label="取り込む回答"
          />
          <p className="fine-print">
            書式付きのコピーはHTMLを優先します。通常の長押し
            →「ペースト」も使えます。
          </p>
        </>
      )}
      <label
        className="file-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          setImportFiles((prev) => [
            ...prev,
            ...Array.from(e.dataTransfer.files),
          ]);
        }}
      >
        <Upload size={23} />
        <strong>
          {importMode === "original"
            ? "スクリーンショットを選ぶ"
            : "ファイルから取り込む"}
        </strong>
        <span>
          {importMode === "original"
            ? "画像を複数選択できます。元のファイルを保持します。"
            : "HTML・Markdown・テキスト・画像・ノートJSON"}
        </span>
        <input
          type="file"
          multiple
          accept={
            importMode === "original"
              ? "image/*"
              : ".html,.htm,.md,.markdown,.txt,.json,image/*"
          }
          onChange={(e) => {
            setImportFiles((prev) => [
              ...prev,
              ...Array.from(e.target.files || []),
            ]);
            e.target.value = "";
          }}
        />
      </label>
      {importFiles.length > 0 && (
        <div className="file-chips">
          {importFiles.map((f, i) => (
            <span key={i}>
              <FileText size={12} />
              {f.name}
              <button
                aria-label={`${f.name}を取り込みから外す`}
                onClick={() =>
                  setImportFiles((p) => p.filter((_, j) => i !== j))
                }
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="import-note">
        <ShieldCheck size={17} />
        <span>
          {importMode === "original"
            ? "原本画像のピクセルは変更しません。注釈は別のレイヤーに保存します。画像内の文字は編集できません。"
            : "原本データも別に保持します。取得できないフォントや動的な表示は、画像での原本保存をご利用ください。"}
        </span>
      </div>
      {note && !note.deletedAt && (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={importAppend}
            onChange={(e) => setImportAppend(e.target.checked)}
          />
          今開いているノートに追加する
        </label>
      )}
      <div className="modal-actions">
        <button className="secondary" onClick={close}>
          キャンセル
        </button>
        <button
          className="primary"
          disabled={importBusy || (!importText.trim() && !importFiles.length)}
          onClick={importContent}
        >
          {importBusy ? (
            <RefreshCw size={16} className="spin" />
          ) : (
            <ArrowDownToLine size={16} />
          )}
          取り込む
        </button>
      </div>
    </Modal>
  );
}
