import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { marked } from "marked";
import type { Original } from "../core/types";
import { sanitizeHtml } from "../core/import";
import { ImageLightbox } from "./Editor";
import "./editor.css";

export interface OriginalViewerProps {
  originals: Original[];
  onNotify?: (message: string) => void;
}

export function OriginalViewer({ originals }: OriginalViewerProps) {
  const [image, setImage] = useState<Original | null>(null);
  if (!originals.length)
    return (
      <div className="original-empty">
        まだ原本がありません。
        <br />
        回答や画像を取り込むと、編集用の内容と一緒に原本を保存します。
      </div>
    );
  return (
    <div className="original-viewer">
      <p className="original-intro">
        <ShieldCheck size={15} />
        取り込んだ元データを保持しています。画像をタップすると原寸で確認できます。
      </p>
      {originals.map((original, index) => (
        <section
          className="original-item"
          key={`${original.capturedAt}-${index}`}
        >
          <header className="original-item-header">
            <strong>
              {original.name ||
                `${original.kind === "image" ? "画像" : original.kind === "html" ? "HTML" : original.kind === "markdown" ? "Markdown" : "テキスト"}の原本 ${index + 1}`}
            </strong>
            <time dateTime={original.capturedAt}>
              {new Date(original.capturedAt).toLocaleDateString("ja-JP", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              })}
            </time>
          </header>
          {original.kind === "image" ? (
            <button
              className="original-image"
              aria-label="原本画像を拡大"
              onClick={() => setImage(original)}
            >
              <img
                src={original.content}
                alt={original.name || "保存した原本画像"}
              />
            </button>
          ) : original.kind === "html" ? (
            <div
              className="original-html"
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(original.content),
              }}
            />
          ) : original.kind === "markdown" ? (
            <div
              className="original-html"
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(
                  marked.parse(original.content, { async: false }),
                ),
              }}
            />
          ) : (
            <pre className="original-raw">{original.content}</pre>
          )}
        </section>
      ))}
      {image && (
        <ImageLightbox
          src={image.content}
          name={image.name}
          onClose={() => setImage(null)}
        />
      )}
    </div>
  );
}

export default OriginalViewer;
