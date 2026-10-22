import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  BookOpen,
  Plus,
  Search,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Star,
  Pin,
  Clock3,
  Trash2,
  Settings2,
  ArrowUpRight,
  ArrowLeft,
  Upload,
  Check,
  CheckCheck,
  Menu,
  MoreHorizontal,
  FileText,
  X,
  Copy,
  History,
  PanelLeftClose,
  Layers,
  Image as ImageIcon,
  ShieldCheck,
  RefreshCw,
  WifiOff,
  CheckSquare,
  ArrowUpDown,
  Pencil,
  Download,
  RotateCcw,
  AlertCircle,
} from "lucide-react";
import type {
  Note,
  Workspace,
  Block,
  Original,
  Folder as FolderType,
} from "./core/types";
import { uid } from "./core/types";
import { useWorkspace } from "./hooks/useWorkspace";
import { createNote } from "./core/seed";
import {
  copyBlocks,
  downloadBackup,
  downloadNote,
  blocksToText,
} from "./core/import";
import { parseProposal } from "./core/ai";
import Editor from "./components/Editor";
import OriginalViewer from "./components/OriginalViewer";
import Modal from "./components/Modal";
import ImportDialog, { type ImportResult } from "./components/ImportDialog";
import SettingsDialog from "./components/SettingsDialog";
import ProposalDiff from "./components/ProposalDiff";

type Dialog =
  | "import"
  | "settings"
  | "folder"
  | "move"
  | "history"
  | "ai"
  | "delete"
  | "export"
  | null;
type Filter =
  | "all"
  | "recent"
  | "favorites"
  | "trash"
  | `folder:${string}`
  | `tag:${string}`;
const dateLabel = (date: string) =>
  new Date(date).toLocaleDateString("ja-JP", {
    month: "short",
    day: "numeric",
  });
const clone = <T,>(x: T): T => structuredClone(x);

export default function App() {
  const { workspace, status, error, mutate, replace, retry } = useWorkspace();
  const [activeId, setActiveId] = useState<string | null>(null),
    [filter, setFilter] = useState<Filter>("all"),
    [search, setSearch] = useState(""),
    [sort, setSort] = useState("updated"),
    [dialog, setDialog] = useState<Dialog>(null),
    [mobileEditor, setMobileEditor] = useState(false),
    [sidebar, setSidebar] = useState(false),
    [view, setView] = useState<"edit" | "original" | "compare">("edit"),
    [selected, setSelected] = useState<string[]>([]),
    [selecting, setSelecting] = useState(false),
    [toast, setToast] = useState(""),
    [more, setMore] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [tagInput, setTagInput] = useState("");
  const [folderName, setFolderName] = useState(""),
    [folderParent, setFolderParent] = useState(""),
    [editingFolder, setEditingFolder] = useState<string | null>(null),
    [expanded, setExpanded] = useState<string[]>([]),
    [moveTarget, setMoveTarget] = useState(""),
    [moveIds, setMoveIds] = useState<string[]>([]),
    [blockMove, setBlockMove] = useState<{
      blocks: Block[];
      ids: string[];
    } | null>(null),
    [targetNote, setTargetNote] = useState("");
  const [proposal, setProposal] = useState("");
  const [plan, setPlan] = useState<ReturnType<typeof parseProposal> | null>(
    null,
  );
  const [swUpdate, setSwUpdate] = useState<ServiceWorkerRegistration | null>(
    null,
  );
  const searchRef = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4200);
  }, []);
  const note = workspace?.notes.find((n) => n.id === activeId) || null;
  const close = useCallback(() => {
    setDialog(null);
    setPlan(null);
    setBlockMove(null);
  }, []);
  useEffect(() => {
    if (workspace && !activeId) {
      setActiveId(workspace.notes.find((n) => !n.deletedAt)?.id || null);
    }
  }, [workspace, activeId]);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
    let timer: ReturnType<typeof setInterval>;
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
      })
      .then((r) => {
        if (r.waiting) setSwUpdate(r);
        r.addEventListener("updatefound", () => {
          const worker = r.installing;
          worker?.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            )
              setSwUpdate(r);
          });
        });
        timer = setInterval(() => r.update(), 60 * 60 * 1000);
      })
      .catch(() =>
        notify(
          "オフライン用ファイルを準備できませんでした。オンラインで再度開いてください。",
        ),
      );
    return () => clearInterval(timer);
  }, [notify]);
  const updateNote = useCallback(
    (id: string, patch: Partial<Note>, checkpoint = true) => {
      mutate((w) => {
        const n = w.notes.find((n) => n.id === id);
        if (!n) return;
        const now = new Date().toISOString();
        if (
          checkpoint &&
          (!n.revisions.length ||
            Date.now() - Date.parse(n.revisions.at(-1)!.at) > 30000)
        ) {
          n.revisions.push({
            id: uid(),
            at: now,
            title: n.title,
            blocks: clone(n.blocks),
          });
          n.revisions = n.revisions.slice(-30);
        }
        Object.assign(n, patch, { updatedAt: now });
      });
    },
    [mutate],
  );
  const appendOriginals = (id: string, originals: Original[]) =>
    mutate((w) => {
      const n = w.notes.find((n) => n.id === id);
      if (n) n.originals.push(...originals);
    });
  const openNote = (id: string) => {
    setActiveId(id);
    setMobileEditor(true);
    setMore(false);
    setView("edit");
    setTagInput("");
  };
  const newNote = useCallback(() => {
    const folderId = filter.startsWith("folder:") ? filter.slice(7) : null;
    const n = createNote(folderId);
    mutate((w) => w.notes.unshift(n));
    setActiveId(n.id);
    setMobileEditor(true);
    setView("edit");
    notify("新しいノートを作成しました");
  }, [filter, mutate, notify]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMobileEditor(false);
        searchRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newNote();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [newNote]);
  const changeFilter = (f: Filter) => {
    setFilter(f);
    setSearch("");
    setSelected([]);
    setSelecting(false);
    setSidebar(false);
    setMobileEditor(false);
  };
  const openFolder = (f?: FolderType) => {
    setEditingFolder(f?.id || null);
    setFolderName(f?.name || "");
    setFolderParent(
      f ? (f.parentId ?? "") : (filter.startsWith("folder:") ? filter.slice(7) : ""),
    );
    setDialog("folder");
  };
  const saveFolder = () => {
    if (!folderName.trim()) return;
    if (folderParent && (!workspace?.folders.some(f => f.id === folderParent) || (editingFolder && descendantIds(editingFolder).includes(folderParent)))) {
      notify("フォルダを自身や子フォルダの中へ移動することはできません。");
      return;
    }
    mutate((w) => {
      if (editingFolder) {
        const folder = w.folders.find((f) => f.id === editingFolder);
        if (folder)
          Object.assign(folder, {
            name: folderName.trim(),
            parentId: folderParent || null,
          });
      } else
        w.folders.push({
          id: uid(),
          name: folderName.trim(),
          parentId: folderParent || null,
          order: w.folders.length,
        });
    });
    notify("フォルダを保存しました");
    close();
  };
  const descendantIds = (id: string): string[] => {
    const children = workspace?.folders.filter((f) => f.parentId === id) || [];
    return [id, ...children.flatMap((f) => descendantIds(f.id))];
  };
  const removeFolder = () => {
    if (!editingFolder) return;
    const ids = descendantIds(editingFolder);
    mutate((w) => {
      w.folders = w.folders.filter((f) => !ids.includes(f.id));
      w.notes.forEach((n) => {
        if (n.folderId && ids.includes(n.folderId)) n.folderId = null;
      });
    });
    if (filter.startsWith("folder:") && ids.includes(filter.slice(7)))
      changeFilter("all");
    notify("フォルダを削除しました。ノートは「すべてのノート」に残ります");
    close();
  };
  const moveNotes = (ids: string[]) => {
    setMoveIds(ids);
    setMoveTarget("");
    setBlockMove(null);
    setDialog("move");
    setMore(false);
  };
  const doMove = () => {
    if (blockMove && note) {
      if (!targetNote) {
        notify("移動先のノートを選んでください");
        return;
      }
      mutate((w) => {
        const from = w.notes.find((n) => n.id === note.id)!,
          to = w.notes.find((n) => n.id === targetNote)!;
        for (const n of [from, to]) {
          n.revisions.push({
            id: uid(),
            at: new Date().toISOString(),
            title: n.title,
            blocks: clone(n.blocks),
          });
          n.revisions = n.revisions.slice(-30);
          n.updatedAt = new Date().toISOString();
        }
        to.blocks.push(
          ...clone(blockMove.blocks).map((b) => ({ ...b, id: uid() })),
        );
        from.blocks = from.blocks.filter((b) => !blockMove.ids.includes(b.id));
      });
      notify("ブロックを別のノートへ移動しました");
    } else {
      mutate((w) =>
        w.notes.forEach((n) => {
          if (moveIds.includes(n.id)) {
            n.folderId = moveTarget || null;
            n.updatedAt = new Date().toISOString();
          }
        }),
      );
      notify(`${moveIds.length}件のノートを移動しました`);
    }
    setSelected([]);
    close();
  };
  const duplicate = (ids: string[]) => {
    mutate((w) => {
      const copies = w.notes
        .filter((n) => ids.includes(n.id))
        .map((n) => ({
          ...clone(n),
          id: uid(),
          title: `${n.title} のコピー`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: null,
          revisions: [],
        }));
      w.notes.unshift(...copies);
    });
    notify(`${ids.length}件のノートを複製しました`);
    setMore(false);
  };
  const trash = (ids: string[]) => {
    mutate((w) =>
      w.notes.forEach((n) => {
        if (ids.includes(n.id)) {
          n.deletedAt = new Date().toISOString();
          n.updatedAt = new Date().toISOString();
        }
      }),
    );
    setSelected([]);
    setMore(false);
    notify("ゴミ箱に移動しました。いつでも復元できます");
  };
  const restore = (ids: string[]) => {
    mutate((w) =>
      w.notes.forEach((n) => {
        if (ids.includes(n.id)) n.deletedAt = null;
      }),
    );
    notify("ノートを復元しました");
    setSelected([]);
  };
  const permanentDelete = () => {
    mutate((w) => (w.notes = w.notes.filter((n) => !moveIds.includes(n.id))));
    if (activeId && moveIds.includes(activeId)) setActiveId(null);
    notify("ノートを完全に削除しました");
    setSelected([]);
    close();
  };
  const requestDelete = (ids: string[]) => {
    setMoveIds(ids);
    setDialog("delete");
  };
  const startImport = () => setDialog("import");
  const acceptImport = (result: ImportResult) => {
    if (result.appendToId) {
      mutate((draft) => {
        const target = draft.notes.find(
          (item) => item.id === result.appendToId && !item.deletedAt,
        );
        if (!target)
          throw new Error(
            "追加先のノートが見つかりません。取り込みをやり直してください。",
          );
        target.revisions.push({
          id: uid(),
          at: new Date().toISOString(),
          title: target.title,
          blocks: clone(target.blocks),
        });
        target.revisions = target.revisions.slice(-30);
        target.blocks.push(...result.blocks);
        target.originals.push(...result.originals);
        target.updatedAt = new Date().toISOString();
      });
    } else {
      const imported = result.importedNote
        ? clone(result.importedNote)
        : createNote();
      imported.folderId = filter.startsWith("folder:") ? filter.slice(7) : null;
      imported.title = result.title;
      imported.blocks = result.blocks;
      imported.originals = result.originals;
      mutate((draft) => draft.notes.unshift(imported));
      openNote(imported.id);
    }
  };
  const restoreWorkspace = async (candidate: Workspace) => {
    if (!workspace) return;
    await downloadBackup(workspace);
    await replace(candidate);
    setActiveId(candidate.notes.find((item) => !item.deletedAt)?.id || null);
    changeFilter("all");
    close();
    notify("復元しました。復元前のバックアップもダウンロードしました");
  };
  const backupWorkspace = async () => {
    if (!workspace) return;
    try {
      await downloadBackup(workspace);
      notify("バックアップをダウンロードしました");
    } catch (error) {
      notify(`バックアップできません：${(error as Error).message}`);
    }
  };
  const getFolder = (id: string | null) =>
    workspace?.folders.find((f) => f.id === id);
  const folderPath = (id: string | null): string[] => {
    const seen = new Set<string>(),
      parts: string[] = [];
    let item = getFolder(id);
    while (item && !seen.has(item.id)) {
      seen.add(item.id);
      parts.unshift(item.name);
      item = getFolder(item.parentId);
    }
    return parts;
  };
  const filterTitle =
    filter === "all"
      ? "すべてのノート"
      : filter === "recent"
        ? "最近のノート"
        : filter === "favorites"
          ? "お気に入り"
          : filter === "trash"
            ? "ゴミ箱"
            : filter.startsWith("tag:")
              ? `# ${filter.slice(4)}`
              : getFolder(filter.slice(7))?.name || "ノート";
  const notes = (workspace?.notes || [])
    .filter((n) => {
      if (filter === "trash" ? !n.deletedAt : !!n.deletedAt) return false;
      if (filter === "favorites" && !n.favorite) return false;
      if (filter.startsWith("folder:") && n.folderId !== filter.slice(7))
        return false;
      if (filter.startsWith("tag:") && !n.tags.includes(filter.slice(4)))
        return false;
      return (
        !search ||
        `${n.title} ${n.tags.join(" ")} ${blocksToText(n.blocks)}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase())
      );
    })
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sort === "created") return b.createdAt.localeCompare(a.createdAt);
      if (sort === "title") return a.title.localeCompare(b.title, "ja");
      if (sort === "manual") return a.order - b.order;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  const allTags = Array.from(
    new Set(
      workspace?.notes.filter((n) => !n.deletedAt).flatMap((n) => n.tags) || [],
    ),
  );
  const renderFolders = (parent: string | null, depth = 0): ReactNode =>
    workspace?.folders
      .filter((f) => f.parentId === parent)
      .sort((a, b) => a.order - b.order)
      .map((f) => {
        const children = workspace.folders.some((c) => c.parentId === f.id);
        const isOpen = expanded.includes(f.id);
        return (
          <div key={f.id}>
            <div
              className={`folder-row ${filter === `folder:${f.id}` ? "active" : ""}`}
              style={{ paddingLeft: 12 + depth * 13 }}
            >
              <button
                aria-label={`${f.name}の子フォルダを${isOpen ? "閉じる" : "開く"}`}
                className={`folder-toggle ${children ? "" : "invisible"}`}
                onClick={() =>
                  setExpanded((prev) =>
                    isOpen ? prev.filter((x) => x !== f.id) : [...prev, f.id],
                  )
                }
              >
                {isOpen ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
              </button>
              <button
                className="folder-main"
                onClick={() => changeFilter(`folder:${f.id}`)}
              >
                {filter === `folder:${f.id}` ? (
                  <FolderOpen size={16} />
                ) : (
                  <Folder size={16} />
                )}
                <span>{f.name}</span>
                <small>
                  {
                    workspace.notes.filter(
                      (n) => n.folderId === f.id && !n.deletedAt,
                    ).length
                  }
                </small>
              </button>
              <button
                className="folder-edit icon-btn"
                aria-label={`${f.name}を編集`}
                onClick={() => openFolder(f)}
              >
                <MoreHorizontal size={14} />
              </button>
            </div>
            {isOpen && renderFolders(f.id, depth + 1)}
          </div>
        );
      });
  if (!workspace)
    return (
      <div className="loading-page">
        <div className="brand-mark">
          <BookOpen size={27} />
        </div>
        <h1>Folio</h1>
        <p>{error || "ノートを開いています…"}</p>
        {error && (
          <button className="primary" onClick={retry}>
            再試行
          </button>
        )}
      </div>
    );
  return (
    <div className={`app ${mobileEditor ? "show-editor" : ""}`}>
      {sidebar && (
        <div className="sidebar-scrim" onClick={() => setSidebar(false)} />
      )}
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <BookOpen size={22} />
          </div>
          <span>
            Folio<span className="brand-dot">.</span>
          </span>
          <button
            className="icon-btn sidebar-close"
            aria-label="サイドバーを閉じる"
            onClick={() => setSidebar(false)}
          >
            <PanelLeftClose size={17} />
          </button>
        </div>
        <div className="workspace-label">
          PERSONAL WORKSPACE <span>個人用</span>
        </div>
        <button className="new-note" onClick={newNote}>
          <Plus size={18} />
          新しいノート<span>⌥ ⌘ N</span>
        </button>
        <nav className="main-nav" aria-label="ノートの分類">
          {(
            [
              { id: "all", label: "すべてのノート", icon: BookOpen },
              { id: "recent", label: "最近のノート", icon: Clock3 },
              { id: "favorites", label: "お気に入り", icon: Star },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={filter === item.id ? "active" : ""}
              onClick={() => changeFilter(item.id)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.id === "all" && (
                <small>
                  {workspace.notes.filter((n) => !n.deletedAt).length}
                </small>
              )}
            </button>
          ))}
        </nav>
        <div className="section-label">
          フォルダ
          <button
            className="icon-btn"
            aria-label="フォルダを追加"
            onClick={() => openFolder()}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="folder-tree">{renderFolders(null)}</div>
        {allTags.length > 0 && (
          <>
            <div className="section-label tags-label">タグ</div>
            <div className="sidebar-tags">
              {allTags.map((t) => (
                <button
                  key={t}
                  className={filter === `tag:${t}` ? "active" : ""}
                  onClick={() => changeFilter(`tag:${t}`)}
                >
                  <span>#</span>
                  {t}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="sidebar-bottom">
          <button className="capture-card" onClick={startImport}>
            <span className="capture-icon">
              <Upload size={19} />
            </span>
            <span>
              <strong>回答を取り込む</strong>
              <small>ひらめきを、そのまま。</small>
            </span>
            <ArrowUpRight size={16} />
          </button>
          <nav className="main-nav utility">
            <button
              className={filter === "trash" ? "active" : ""}
              onClick={() => changeFilter("trash")}
            >
              <Trash2 size={17} />
              <span>ゴミ箱</span>
              <small>
                {workspace.notes.filter((n) => n.deletedAt).length || ""}
              </small>
            </button>
            <button onClick={() => setDialog("settings")}>
              <Settings2 size={17} />
              <span>設定とバックアップ</span>
            </button>
          </nav>
          <div className="local-status">
            <span className="status-dot" />
            <span>この端末に保存</span>
            <ShieldCheck size={13} />
          </div>
        </div>
      </aside>
      <section className="library">
        <div className="library-heading">
          <button
            className="icon-btn mobile-menu"
            aria-label="メニューを開く"
            onClick={() => setSidebar(true)}
          >
            <Menu size={21} />
          </button>
          <h1>{filterTitle}</h1>
          <button
            className="icon-btn"
            aria-label="ノートを作成"
            onClick={newNote}
          >
            <Plus size={19} />
          </button>
        </div>
        <label className="search-box">
          <Search size={16} />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ノートを検索…"
            aria-label="ノートを検索"
          />
          <kbd>⌘ K</kbd>
        </label>
        <div className="library-tools">
          <span>{notes.length} 件のノート</span>
          <label title="並べ替え">
            <ArrowUpDown size={13} />
            <select
              aria-label="ノートの並べ替え"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="updated">更新日順</option>
              <option value="created">作成日順</option>
              <option value="title">タイトル順</option>
              <option value="manual">手動順</option>
            </select>
          </label>
          <button
            className={`icon-btn ${selecting ? "active" : ""}`}
            aria-label="ノートを複数選択"
            onClick={() => {
              setSelecting(!selecting);
              setSelected([]);
            }}
          >
            <CheckSquare size={15} />
          </button>
        </div>
        {selecting && (
          <div className="bulk-notes">
            <button
              onClick={() =>
                setSelected(
                  selected.length === notes.length
                    ? []
                    : notes.map((n) => n.id),
                )
              }
            >
              {selected.length === notes.length ? "選択解除" : "すべて選択"}
            </button>
            <span>{selected.length}件</span>
            {filter === "trash" ? (
              <>
                <button
                  disabled={!selected.length}
                  onClick={() => restore(selected)}
                  title="復元"
                >
                  <RotateCcw size={15} />
                </button>
                <button
                  disabled={!selected.length}
                  onClick={() => requestDelete(selected)}
                  title="完全に削除"
                >
                  <Trash2 size={15} />
                </button>
              </>
            ) : (
              <>
                <button
                  disabled={!selected.length}
                  onClick={() => moveNotes(selected)}
                  title="移動"
                >
                  <Folder size={15} />
                </button>
                <button
                  disabled={!selected.length}
                  onClick={() => duplicate(selected)}
                  title="複製"
                >
                  <Copy size={15} />
                </button>
                <button
                  disabled={!selected.length}
                  onClick={() => trash(selected)}
                  title="ゴミ箱へ"
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>
        )}
        <div className="note-list">
          {notes.map((n) => (
            <article
              key={n.id}
              className={`note-card ${activeId === n.id ? "active" : ""} ${selected.includes(n.id) ? "selected" : ""}`}
              draggable={!selecting}
              onDragStart={(e) => {
                e.dataTransfer.setData("folio/note", n.id);
              }}
              onDragOver={(e) => {
                if (sort === "manual") e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("folio/note");
                if (!id || id === n.id || sort !== "manual") return;
                mutate((w) => {
                  const sorted = [...notes];
                  const from = sorted.findIndex((v) => v.id === id),
                    to = sorted.findIndex((v) => v.id === n.id);
                  if (from < 0) return;
                  const [moving] = sorted.splice(from, 1);
                  sorted.splice(to, 0, moving);
                  sorted.forEach((v, i) => {
                    const a = w.notes.find((x) => x.id === v.id)!;
                    a.order = i;
                  });
                });
              }}
            >
              <button
                className="note-open"
                onClick={() =>
                  selecting
                    ? setSelected((prev) =>
                        prev.includes(n.id)
                          ? prev.filter((id) => id !== n.id)
                          : [...prev, n.id],
                      )
                    : openNote(n.id)
                }
              >
                <div className="note-card-top">
                  {selecting ? (
                    <span
                      className={`check-box ${selected.includes(n.id) ? "checked" : ""}`}
                    >
                      {selected.includes(n.id) && <Check size={12} />}
                    </span>
                  ) : n.originals.some((o) => o.kind === "image") ? (
                    <ImageIcon size={15} />
                  ) : (
                    <FileText size={15} />
                  )}
                  <span>{getFolder(n.folderId)?.name || "マイノート"}</span>
                  {n.pinned && <Pin size={12} />}
                  <time>{dateLabel(n.updatedAt)}</time>
                </div>
                <h2>
                  {n.title || "無題のノート"}
                  {n.favorite && <Star size={12} fill="currentColor" />}
                </h2>
                <p>
                  {blocksToText(n.blocks).replace(/\s+/g, " ").slice(0, 95) ||
                    "ここから新しいアイデアを。"}
                </p>
                <div className="note-card-tags">
                  {n.tags.slice(0, 2).map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                  {n.originals.length > 0 && (
                    <small>
                      <Layers size={10} />
                      原本あり
                    </small>
                  )}
                </div>
              </button>
            </article>
          ))}
          {!notes.length && (
            <div className="empty-list">
              <Search size={29} />
              <h3>
                {search ? "見つかりませんでした" : "まだノートがありません"}
              </h3>
              <p>
                {search
                  ? "キーワードを変えて探してみましょう。"
                  : "新しいノートから始めましょう。"}
              </p>
              <button
                className="subtle"
                onClick={search ? () => setSearch("") : newNote}
              >
                {search ? "検索をクリア" : "ノートを作成"}
              </button>
            </div>
          )}
        </div>
        <div className="library-footer">
          <span className="tiny-logo">F</span>小さなひらめき、大きな知識。
        </div>
      </section>
      <main className="main-pane">
        <header className="document-header">
          <button
            className="icon-btn back-library"
            aria-label="ノート一覧に戻る"
            onClick={() => setMobileEditor(false)}
          >
            <ArrowLeft size={20} />
          </button>
          <div className="breadcrumbs">
            <span>マイノート</span>
            {note &&
              folderPath(note.folderId).map((p, i) => (
                <span key={i}>
                  <ChevronRight size={12} />
                  {p}
                </span>
              ))}
          </div>
          <div
            className={`save-indicator ${status === "error" ? "error" : ""}`}
          >
            {status === "saved" ? (
              <CheckCheck size={14} />
            ) : status === "error" ? (
              <AlertCircle size={14} />
            ) : (
              <RefreshCw size={13} className="spin" />
            )}
            <span>
              {status === "saved"
                ? "保存済み"
                : status === "error"
                  ? "保存できません"
                  : "保存中…"}
            </span>
          </div>
          {!online && <WifiOff size={16} aria-label="オフライン" />}
          {note && (
            <>
              <button
                className={`icon-btn favorite-btn ${note.favorite ? "active" : ""}`}
                aria-label={
                  note.favorite ? "お気に入り解除" : "お気に入りに追加"
                }
                onClick={() =>
                  updateNote(note.id, { favorite: !note.favorite }, false)
                }
              >
                <Star
                  size={18}
                  fill={note.favorite ? "currentColor" : "none"}
                />
              </button>
              <div className="menu-anchor">
                <button
                  className="icon-btn"
                  aria-label="ノートの操作"
                  aria-expanded={more}
                  onClick={() => setMore(!more)}
                >
                  <MoreHorizontal size={21} />
                </button>
                {more && (
                  <>
                    <div
                      className="menu-dismiss"
                      onClick={() => setMore(false)}
                    />
                    <div className="dropdown">
                      <button
                        onClick={async () => {
                          try {
                            await copyBlocks(note.blocks);
                            notify("ノート全体をコピーしました");
                          } catch {
                            notify(
                              "コピーできませんでした。本文を選択して通常のコピーをお使いください。",
                            );
                          }
                          setMore(false);
                        }}
                      >
                        <Copy size={16} />
                        ノート全体をコピー
                      </button>
                      <button
                        onClick={() => {
                          updateNote(note.id, { pinned: !note.pinned }, false);
                          setMore(false);
                        }}
                      >
                        <Pin size={16} />
                        {note.pinned ? "ピン留めを解除" : "ピン留め"}
                      </button>
                      <button onClick={() => duplicate([note.id])}>
                        <Copy size={16} />
                        ノートを複製
                      </button>
                      <button onClick={() => moveNotes([note.id])}>
                        <Folder size={16} />
                        フォルダへ移動
                      </button>
                      <button
                        onClick={() => {
                          setDialog("history");
                          setMore(false);
                        }}
                      >
                        <History size={16} />
                        編集履歴
                      </button>
                      <button
                        onClick={() => {
                          setDialog("export");
                          setMore(false);
                        }}
                      >
                        <Download size={16} />
                        エクスポート
                      </button>
                      <button
                        className="danger"
                        onClick={() =>
                          note.deletedAt
                            ? requestDelete([note.id])
                            : trash([note.id])
                        }
                      >
                        <Trash2 size={16} />
                        {note.deletedAt ? "完全に削除" : "ゴミ箱へ移動"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </header>
        {status === "error" && (
          <div className="error-banner">
            <AlertCircle size={16} />
            <span>
              {error ||
                "保存できません。バックアップを作成し、空き容量や別タブを確認してください。"}
            </span>
            <button onClick={() => void backupWorkspace()}>バックアップ</button>
            <button onClick={retry}>再試行</button>
          </div>
        )}
        {swUpdate && (
          <div className="update-banner">
            新しいバージョンを利用できます。
            <button
              disabled={status !== "saved"}
              onClick={() => {
                swUpdate.waiting?.postMessage({ type: "SKIP_WAITING" });
                navigator.serviceWorker.addEventListener(
                  "controllerchange",
                  () => window.location.reload(),
                  { once: true },
                );
              }}
            >
              保存して更新
            </button>
          </div>
        )}
        {note ? (
          <div className="document-scroll" key={note.id}>
            {note.deletedAt && (
              <div className="trash-banner">
                <Trash2 size={16} />
                このノートはゴミ箱にあります
                <button onClick={() => restore([note.id])}>復元する</button>
              </div>
            )}
            <div className="document-content">
              <div className="document-eyebrow">
                <span className="eyebrow-line" />
                {note.originals.length
                  ? "CAPTURED & COLLECTED"
                  : "YOUR PERSONAL NOTEBOOK"}
              </div>
              <input
                className="document-title"
                aria-label="ノートのタイトル"
                value={note.title}
                disabled={!!note.deletedAt}
                onChange={(e) => updateNote(note.id, { title: e.target.value })}
                placeholder="無題のノート"
              />
              <div className="note-metadata">
                <span>
                  <Clock3 size={13} />
                  {dateLabel(note.updatedAt)} 更新
                </span>
                <span className="metadata-dot">·</span>
                <span>
                  {blocksToText(note.blocks).length.toLocaleString()} 文字
                </span>
                {note.originals.length > 0 && (
                  <span className="original-badge">
                    <ShieldCheck size={12} />
                    原本を保持
                  </span>
                )}
              </div>
              <div className="note-tags">
                {note.tags.map((t) => (
                  <span key={t} className="tag-chip">
                    <span>#</span>
                    {t}
                    <button
                      aria-label={`タグ ${t} を削除`}
                      disabled={!!note.deletedAt}
                      onClick={() =>
                        updateNote(
                          note.id,
                          { tags: note.tags.filter((x) => x !== t) },
                          false,
                        )
                      }
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {!note.deletedAt && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const t = tagInput.trim().replace(/^#/, "");
                      if (t && !note.tags.includes(t))
                        updateNote(note.id, { tags: [...note.tags, t] }, false);
                      setTagInput("");
                    }}
                  >
                    <Plus size={12} />
                    <input
                      aria-label="タグを追加"
                      placeholder="タグを追加"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onBlur={() => {
                        const t = tagInput.trim().replace(/^#/, "");
                        if (t && !note.tags.includes(t)) {
                          updateNote(
                            note.id,
                            { tags: [...note.tags, t] },
                            false,
                          );
                          setTagInput("");
                        }
                      }}
                    />
                  </form>
                )}
              </div>
              <div className="document-tabs">
                <div className="segmented">
                  {(
                    [
                      { id: "edit", label: "編集", icon: Pencil },
                      { id: "original", label: "原本", icon: Layers },
                      { id: "compare", label: "比較", icon: BookOpen },
                    ] as const
                  ).map((v) => (
                    <button
                      key={v.id}
                      className={view === v.id ? "active" : ""}
                      onClick={() => setView(v.id)}
                    >
                      <v.icon size={13} />
                      {v.label}
                      {v.id === "original" && note.originals.length > 0 && (
                        <small>{note.originals.length}</small>
                      )}
                    </button>
                  ))}
                </div>
                <button className="text-action" onClick={startImport}>
                  <Plus size={14} />
                  取り込む
                </button>
              </div>
              {view === "original" ? (
                <OriginalViewer originals={note.originals} onNotify={notify} />
              ) : view === "compare" ? (
                <div className="compare-layout">
                  <section>
                    <div className="compare-label">取り込み時の原本</div>
                    <OriginalViewer
                      originals={note.originals}
                      onNotify={notify}
                    />
                  </section>
                  <section>
                    <div className="compare-label">
                      現在の編集内容 <span>{note.revisions.length} 履歴</span>
                    </div>
                    <div
                      className={note.deletedAt ? "readonly" : ""}
                      inert={!!note.deletedAt}
                    >
                      <Editor
                        note={note}
                        onChange={(blocks) => updateNote(note.id, { blocks })}
                        onNotify={notify}
                        onCaptureOriginals={(originals) =>
                          appendOriginals(note.id, originals)
                        }
                      />
                    </div>
                  </section>
                </div>
              ) : (
                <div
                  className={note.deletedAt ? "readonly" : ""}
                  inert={!!note.deletedAt}
                >
                  <Editor
                    note={note}
                    onChange={(blocks) => updateNote(note.id, { blocks })}
                    onNotify={notify}
                    onCaptureOriginals={(originals) =>
                      appendOriginals(note.id, originals)
                    }
                    onMoveBlocks={(blocks, ids) => {
                      setBlockMove({ blocks, ids });
                      setTargetNote("");
                      setDialog("move");
                    }}
                  />
                </div>
              )}
              <div className="document-end">
                <span />
                <BookOpen size={14} />
                <span />
              </div>
            </div>
          </div>
        ) : (
          <div className="no-document">
            <div className="brand-mark">
              <BookOpen size={28} />
            </div>
            <h2>知識が育つ、余白。</h2>
            <p>ノートを選ぶか、新しいアイデアを残しましょう。</p>
            <button className="primary" onClick={newNote}>
              <Plus size={16} />
              新しいノート
            </button>
          </div>
        )}
      </main>
      {status === "error" && error?.includes("編集を停止") && (
        <div
          className="conflict-lock"
          role="alertdialog"
          aria-modal="true"
          aria-label="別のタブで変更されました"
        >
          <div>
            <AlertCircle size={28} />
            <h2>別のタブで変更されました</h2>
            <p>
              上書きを防ぐため、編集を停止しました。この画面の内容をバックアップしてから再読み込みしてください。
            </p>
            <button className="primary" onClick={() => void backupWorkspace()}>
              この画面のバックアップを保存
            </button>
            <button
              className="secondary"
              onClick={() => window.location.reload()}
            >
              最新の保存データを読み込む
            </button>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{toast}</span>
          <button aria-label="通知を閉じる" onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {dialog === "folder" && (
        <Modal
          title={editingFolder ? "フォルダを編集" : "新しいフォルダ"}
          onClose={close}
        >
          <label className="field-label">
            フォルダ名
            <input
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="例：学びのノート"
              onKeyDown={(e) => {
                if (e.key === "Enter") saveFolder();
              }}
            />
          </label>
          <label className="field-label">
            保存先
            <select
              value={folderParent}
              onChange={(e) => setFolderParent(e.target.value)}
            >
              <option value="">マイノート（最上位）</option>
              {workspace.folders
                .filter(
                  (f) =>
                    !editingFolder ||
                    !descendantIds(editingFolder).includes(f.id),
                )
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {folderPath(f.id).join(" / ")}
                  </option>
                ))}
            </select>
          </label>
          <div className="modal-actions">
            {editingFolder && (
              <button className="danger subtle" onClick={removeFolder}>
                <Trash2 size={15} />
                フォルダを削除
              </button>
            )}
            <button
              className="primary"
              disabled={!folderName.trim()}
              onClick={saveFolder}
            >
              保存する
            </button>
          </div>
          {editingFolder && (
            <p className="fine-print">
              フォルダを削除しても、含まれるノートは削除されません。
            </p>
          )}
        </Modal>
      )}
      {dialog === "move" && (
        <Modal
          title={
            blockMove
              ? "ブロックを別のノートへ移動"
              : `${moveIds.length}件のノートを移動`
          }
          onClose={close}
        >
          <label className="field-label">
            移動先
            {blockMove ? (
              <select
                value={targetNote}
                onChange={(e) => setTargetNote(e.target.value)}
              >
                <option value="">ノートを選択…</option>
                {workspace.notes
                  .filter((n) => n.id !== activeId && !n.deletedAt)
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.title || "無題のノート"}
                    </option>
                  ))}
              </select>
            ) : (
              <select
                value={moveTarget}
                onChange={(e) => setMoveTarget(e.target.value)}
              >
                <option value="">マイノート（フォルダなし）</option>
                {workspace.folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {folderPath(f.id).join(" / ")}
                  </option>
                ))}
              </select>
            )}
          </label>
          <div className="modal-actions">
            <button className="secondary" onClick={close}>
              キャンセル
            </button>
            <button
              className="primary"
              disabled={!!blockMove && !targetNote}
              onClick={doMove}
            >
              移動する
            </button>
          </div>
        </Modal>
      )}
      {dialog === "delete" && (
        <Modal title="ノートを完全に削除" onClose={close}>
          <p>
            {moveIds.length}
            件のノートを端末から削除します。この操作は元に戻せません。
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={close}>
              キャンセル
            </button>
            <button className="danger-button" onClick={permanentDelete}>
              完全に削除する
            </button>
          </div>
        </Modal>
      )}
      {dialog === "export" && note && (
        <Modal title="ノートをエクスポート" onClose={close}>
          <p className="muted">
            目的に合わせて保存できます。原本・履歴を含む全データは「設定とバックアップ」から保存してください。
          </p>
          <div className="option-list">
            {(
              [
                {
                  format: "html",
                  title: "HTML",
                  text: "書式・画像・表を含む表示用ファイル",
                },
                {
                  format: "markdown",
                  title: "Markdown",
                  text: "テキストを再利用しやすい形式",
                },
                {
                  format: "json",
                  title: "ノートデータ（JSON）",
                  text: "ブロック・原本・履歴を保持。取り込みから再利用",
                },
              ] as const
            ).map((v) => (
              <button
                key={v.format}
                onClick={() => {
                  downloadNote(note, v.format);
                  notify("エクスポートしました");
                  close();
                }}
              >
                <FileText size={23} />
                <span>
                  <strong>{v.title}</strong>
                  <small>{v.text}</small>
                </span>
                <Download size={18} />
              </button>
            ))}
          </div>
        </Modal>
      )}
      {dialog === "history" && note && (
        <Modal title="編集履歴" onClose={close}>
          <p className="muted">
            30秒ごとの編集開始時の状態を、最大30件保持します。復元前の状態も履歴に残ります。
          </p>
          <div className="revision-list">
            {[...note.revisions].reverse().map((r) => (
              <div key={r.id}>
                <History size={18} />
                <span>
                  <strong>{r.title || "無題のノート"}</strong>
                  <small>
                    {new Date(r.at).toLocaleString("ja-JP")} · {r.blocks.length}
                    ブロック
                  </small>
                </span>
                <button
                  className="secondary"
                  onClick={() => {
                    mutate((w) => {
                      const n = w.notes.find((n) => n.id === note.id)!;
                      n.revisions.push({
                        id: uid(),
                        at: new Date().toISOString(),
                        title: n.title,
                        blocks: clone(n.blocks),
                      });
                      n.revisions = n.revisions.slice(-30);
                      n.title = r.title;
                      n.blocks = clone(r.blocks);
                      n.updatedAt = new Date().toISOString();
                    });
                    notify("選択した履歴へ復元しました");
                    close();
                  }}
                >
                  復元
                </button>
              </div>
            ))}
            {!note.revisions.length && (
              <div className="empty-state">
                <History size={32} />
                <p>編集すると、ここに履歴が残ります。</p>
              </div>
            )}
          </div>
        </Modal>
      )}
      {dialog === "import" && (
        <ImportDialog
          note={note}
          onClose={close}
          onNotify={notify}
          onImport={acceptImport}
        />
      )}
      {dialog === "settings" && (
        <SettingsDialog
          workspace={workspace}
          onClose={close}
          onNotify={notify}
          onRestore={restoreWorkspace}
          onOpenAi={() => {
            setDialog("ai");
            setProposal("");
            setPlan(null);
          }}
        />
      )}
      {dialog === "ai" && (
        <Modal title="AIの変更提案を確認" onClose={close} wide>
          <p className="muted">
            ChatGPTへの常時接続はありません。API形式のJSONを貼り付け、変更対象を確認してから適用できます。既存ノートの変更には更新日時による競合チェックを行います。
          </p>
          <div className="settings-buttons">
            <button
              className="secondary"
              onClick={async () => {
                const context = JSON.stringify(
                  {
                    version: 1,
                    folders: workspace.folders,
                    notes: workspace.notes
                      .filter((n) => !n.deletedAt)
                      .map((n) => ({
                        id: n.id,
                        title: n.title,
                        updatedAt: n.updatedAt,
                        blocks: n.blocks,
                      })),
                  },
                  null,
                  2,
                );
                try {
                  await navigator.clipboard.writeText(context);
                  notify(
                    "AIに渡すノート情報をコピーしました。送信前に内容をご確認ください。",
                  );
                } catch {
                  notify(
                    "コピーできませんでした。ノートをエクスポートしてお使いください。",
                  );
                }
              }}
            >
              <Copy size={15} />
              ノート情報をコピー
            </button>
            <button
              className="secondary"
              onClick={() => {
                setProposal(
                  JSON.stringify(
                    {
                      version: 1,
                      operations: [
                        {
                          op: "create_note",
                          title: "AIからの新しいノート",
                          folderId: null,
                          blocks: [
                            {
                              id: uid(),
                              type: "text",
                              html: "<p>ここに保存したい内容を入れます。</p>",
                            },
                          ],
                        },
                      ],
                    },
                    null,
                    2,
                  ),
                );
                setPlan(null);
              }}
            >
              形式の例を入れる
            </button>
          </div>
          <textarea
            className="proposal-text"
            aria-label="AI変更提案JSON"
            value={proposal}
            onChange={(e) => {
              setProposal(e.target.value);
              setPlan(null);
            }}
            placeholder='{"version":1,"operations":[…]}'
          />
          {plan && (
            <div className="restore-preview">
              <strong>適用する変更（{plan.summary.length}件）</strong>
              <ul>
                {plan.summary.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
              <ProposalDiff before={workspace} after={plan.next} />
              <p>適用前の状態はバックアップとして保存します。</p>
            </div>
          )}
          <div className="modal-actions">
            <button className="secondary" onClick={close}>
              キャンセル
            </button>
            {plan ? (
              <button
                className="primary"
                onClick={async () => {
                  try {
                    const current = parseProposal(proposal, workspace);
                    await downloadBackup(workspace);
                    await replace(current.next);
                    notify("確認した変更を適用しました");
                    close();
                  } catch (e) {
                    setPlan(null);
                    notify((e as Error).message);
                  }
                }}
              >
                確認した変更を適用
              </button>
            ) : (
              <button
                className="primary"
                disabled={!proposal.trim()}
                onClick={() => {
                  try {
                    setPlan(parseProposal(proposal, workspace));
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                変更をプレビュー
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
