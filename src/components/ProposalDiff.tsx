import type { Note, Workspace } from "../core/types";
import { blocksToHtml } from "../core/import";

const editable = (note: Note) => ({
  title: note.title,
  folderId: note.folderId,
  tags: note.tags,
  favorite: note.favorite,
  pinned: note.pinned,
  deletedAt: note.deletedAt,
  sourceUrl: note.sourceUrl,
  blocks: note.blocks,
});
function folderPath(workspace: Workspace, id: string | null): string {
  const names: string[] = [],
    seen = new Set<string>();
  let folder = workspace.folders.find((item) => item.id === id);
  while (folder && !seen.has(folder.id)) {
    seen.add(folder.id);
    names.unshift(folder.name);
    folder = workspace.folders.find((item) => item.id === folder!.parentId);
  }
  return names.join(" / ") || "マイノート";
}
function NotePreview({
  note,
  workspace,
  label,
}: {
  note?: Note;
  workspace: Workspace;
  label: string;
}) {
  return (
    <section aria-label={label}>
      <h5>{label}</h5>
      {note ? (
        <>
          <strong>{note.title || "無題のノート"}</strong>
          <div className="proposal-diff-meta">
            <span>保存先: {folderPath(workspace, note.folderId)}</span>
            <span>
              タグ: {note.tags.map((tag) => `#${tag}`).join(" ") || "なし"}
            </span>
            <span>
              お気に入り: {note.favorite ? "あり" : "なし"} / ピン:{" "}
              {note.pinned ? "あり" : "なし"} /{" "}
              {note.deletedAt ? "ゴミ箱" : "通常のノート"}
            </span>
            {note.sourceUrl && <span>元 URL: {note.sourceUrl}</span>}
          </div>
          <div
            className="proposal-diff-content"
            dangerouslySetInnerHTML={{ __html: blocksToHtml(note.blocks) }}
          />
        </>
      ) : (
        <p className="muted">存在しません（新規作成）</p>
      )}
    </section>
  );
}

/** A preview of actual user-visible values, not merely a list of operation names. */
export default function ProposalDiff({
  before,
  after,
}: {
  before: Workspace;
  after: Workspace;
}) {
  const changedNotes = after.notes.filter((note) => {
    const old = before.notes.find((item) => item.id === note.id);
    return (
      !old || JSON.stringify(editable(old)) !== JSON.stringify(editable(note))
    );
  });
  const changedFolders = after.folders.filter((folder) => {
    const old = before.folders.find((item) => item.id === folder.id);
    return !old || old.name !== folder.name || old.parentId !== folder.parentId;
  });
  return (
    <div className="proposal-diff" aria-label="変更内容の比較">
      {changedFolders.map((folder) => {
        const old = before.folders.find((item) => item.id === folder.id);
        return (
          <div className="proposal-change" key={folder.id}>
            <strong>フォルダ: {folder.name}</strong>
            <p>
              {old ? folderPath(before, old.id) : "新規作成"} →{" "}
              {folderPath(after, folder.id)}
            </p>
          </div>
        );
      })}
      {changedNotes.map((note) => (
        <details
          className="proposal-change"
          key={note.id}
          open={changedNotes.length <= 3}
        >
          <summary>{note.title || "無題のノート"} — 変更前と変更後</summary>
          <div className="proposal-diff-grid">
            <NotePreview
              label="変更前"
              workspace={before}
              note={before.notes.find((item) => item.id === note.id)}
            />
            <NotePreview label="変更後" workspace={after} note={note} />
          </div>
        </details>
      ))}
    </div>
  );
}
