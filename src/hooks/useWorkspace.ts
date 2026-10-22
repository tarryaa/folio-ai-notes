import { useCallback, useEffect, useRef, useState } from "react";
import { seedWorkspace } from "../core/seed";
import { validateWorkspace } from "../core/import";
import {
  loadWorkspace,
  saveWorkspace,
  storageErrorMessage,
  StorageConflictError,
} from "../core/storage";
import type { SaveStatus, Workspace } from "../core/types";

export function useWorkspace(): {
  workspace: Workspace | null;
  status: SaveStatus;
  error: string | null;
  mutate: (fn: (draft: Workspace) => void) => void;
  replace: (workspace: Workspace) => Promise<void>;
  retry: () => void;
} {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const current = useRef<Workspace | null>(null);
  const revision = useRef(0),
    dirty = useRef(false),
    conflict = useRef(false),
    replacing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const mounted = useRef(true);

  const reportFailure = useCallback((cause: unknown) => {
    if (cause instanceof StorageConflictError) conflict.current = true;
    if (mounted.current) {
      setStatus("error");
      setError(storageErrorMessage(cause));
    }
  }, []);

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (saving.current) {
      if (!(await saving.current)) return false;
      // An edit may have arrived while the previous transaction was committing.
      return flush();
    }
    if (!dirty.current || !current.current) return true;
    if (conflict.current) return false;
    const target = current.current;
    if (mounted.current) setStatus("saving");
    const task = (async () => {
      try {
        const next = await saveWorkspace(target, revision.current);
        revision.current = next;
        channel.current?.postMessage({ revision: next });
        if (current.current === target) {
          dirty.current = false;
          if (mounted.current) {
            setStatus("saved");
            setError(null);
          }
        }
        return true;
      } catch (cause) {
        reportFailure(cause);
        return false;
      }
    })();
    saving.current = task;
    const succeeded = await task;
    saving.current = null;
    if (succeeded && dirty.current && mounted.current) return flush();
    return succeeded;
  }, [reportFailure]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    async function initialize() {
      try {
        const loaded = await loadWorkspace();
        if (cancelled) return;
        let data = loaded.workspace;
        revision.current = loaded.revision;
        if (!data) {
          data = seedWorkspace();
          revision.current = await saveWorkspace(data, loaded.revision);
        }
        if (cancelled) return;
        current.current = data;
        dirty.current = loaded.recovered;
        setWorkspace(data);
        if (loaded.recovered) {
          setStatus("error");
          setError(
            "保存データの不整合を検出し、直前の正常な状態を読み込みました。「再試行」で復旧内容を保存してください。元の保存データは自動消去していません。",
          );
        } else {
          setStatus("saved");
          setError(null);
        }
        // Request persistence only as a best-effort storage hint; backups remain essential.
        void navigator.storage?.persist?.().catch(() => false);
      } catch (cause) {
        if (!cancelled) reportFailure(cause);
      }
    }
    void initialize();
    if (typeof BroadcastChannel !== "undefined") {
      const connection = new BroadcastChannel("folio-workspace");
      channel.current = connection;
      connection.onmessage = (event) => {
        if (
          typeof event.data?.revision === "number" &&
          event.data.revision > revision.current &&
          current.current
        )
          reportFailure(new StorageConflictError());
      };
    }
    const visibility = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const pagehide = () => {
      void flush();
    };
    const beforeunload = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      void flush();
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("beforeunload", beforeunload);
    return () => {
      cancelled = true;
      mounted.current = false;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("beforeunload", beforeunload);
      if (timer.current) clearTimeout(timer.current);
      void flush();
      channel.current?.close();
      channel.current = null;
    };
  }, [flush, reportFailure]);

  const mutate = useCallback(
    (fn: (draft: Workspace) => void) => {
      if (!current.current || conflict.current || replacing.current) return;
      const draft = structuredClone(current.current);
      fn(draft);
      current.current = draft;
      dirty.current = true;
      setWorkspace(draft);
      setStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush();
      }, 550);
    },
    [flush],
  );

  const replace = useCallback(
    async (incoming: Workspace) => {
      const validated = validateWorkspace(incoming);
      if (conflict.current) throw new StorageConflictError();
      if (replacing.current) throw new Error("復元処理が進行中です。");
      replacing.current = true;
      try {
        if (!(await flush()))
          throw new Error(
            "現在の変更を保存できないため、復元を中止しました。先にバックアップしてください。",
          );
        setStatus("saving");
        const next = await saveWorkspace(validated, revision.current);
        revision.current = next;
        current.current = validated;
        dirty.current = false;
        channel.current?.postMessage({ revision: next });
        setWorkspace(validated);
        setStatus("saved");
        setError(null);
      } catch (cause) {
        reportFailure(cause);
        throw cause;
      } finally {
        replacing.current = false;
      }
    },
    [flush, reportFailure],
  );

  const retry = useCallback(() => {
    if (!current.current) {
      window.location.reload();
      return;
    }
    void flush();
  }, [flush]);
  return { workspace, status, error, mutate, replace, retry };
}
