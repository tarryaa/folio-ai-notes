import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspace } from "../src/hooks/useWorkspace";
import { StrictMode } from "react";
import * as storage from "../src/core/storage";

beforeEach(async () => {
  await storage.closeStorage();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(storage.DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await storage.closeStorage();
});

describe("automatic saving lifecycle", () => {
  it("initializes one workspace under React StrictMode and reloads saved edits on remount", async () => {
    const first = renderHook(useWorkspace, { wrapper: StrictMode });
    await waitFor(() => expect(first.result.current.status).toBe("saved"));
    expect(first.result.current.error).toBeNull();
    expect(first.result.current.workspace!.notes).toHaveLength(4);
    act(() => {
      first.result.current.mutate((draft) => {
        draft.notes[0].title = "再起動後も残す";
      });
      window.dispatchEvent(new Event("pagehide"));
    });
    await waitFor(() => expect(first.result.current.status).toBe("saved"));
    first.unmount();
    const second = renderHook(useWorkspace, { wrapper: StrictMode });
    await waitFor(() => expect(second.result.current.status).toBe("saved"));
    expect(second.result.current.workspace!.notes[0].title).toBe(
      "再起動後も残す",
    );
    expect((await storage.loadWorkspace()).revision).toBe(2);
    second.unmount();
  });

  it("debounces edits, visibly reports failed saves, and retries the unsaved content", async () => {
    const hook = renderHook(useWorkspace);
    await waitFor(() => expect(hook.result.current.status).toBe("saved"));
    const failure = vi
      .spyOn(storage, "saveWorkspace")
      .mockRejectedValueOnce(new DOMException("full", "QuotaExceededError"));
    vi.useFakeTimers();
    act(() =>
      hook.result.current.mutate((draft) => {
        draft.notes[0].title = "失われない変更";
      }),
    );
    expect(hook.result.current.status).toBe("saving");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(hook.result.current.status).toBe("error");
    expect(hook.result.current.error).toContain("保存容量");
    expect(hook.result.current.workspace!.notes[0].title).toBe(
      "失われない変更",
    );
    failure.mockRestore();
    vi.useRealTimers();
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.status).toBe("saved"));
    expect((await storage.loadWorkspace()).workspace!.notes[0].title).toBe(
      "失われない変更",
    );
    hook.unmount();
  });

  it("flushes a pending edit on pagehide instead of waiting for the debounce", async () => {
    const hook = renderHook(useWorkspace);
    await waitFor(() => expect(hook.result.current.status).toBe("saved"));
    act(() => {
      hook.result.current.mutate((draft) => {
        draft.notes[0].title = "画面を閉じる前の変更";
      });
      window.dispatchEvent(new Event("pagehide"));
    });
    await waitFor(() => expect(hook.result.current.status).toBe("saved"));
    expect((await storage.loadWorkspace()).workspace!.notes[0].title).toBe(
      "画面を閉じる前の変更",
    );
    hook.unmount();
  });

  it("rejects invalid replacements before changing the displayed or saved notes", async () => {
    const hook = renderHook(useWorkspace);
    await waitFor(() => expect(hook.result.current.status).toBe("saved"));
    const original = structuredClone(hook.result.current.workspace!);
    const invalid = structuredClone(original);
    invalid.notes[0].folderId = "missing-folder";
    await act(async () => {
      await expect(hook.result.current.replace(invalid)).rejects.toThrow(
        "不整合",
      );
    });
    expect(hook.result.current.workspace).toEqual(original);
    expect((await storage.loadWorkspace()).workspace).toEqual(original);
    hook.unmount();
  });

  it("blocks stale edits after another tab saves without replacing the local backup copy", async () => {
    const a = renderHook(useWorkspace);
    await waitFor(() => expect(a.result.current.status).toBe("saved"));
    const b = renderHook(useWorkspace);
    await waitFor(() => expect(b.result.current.status).toBe("saved"));
    const previous = structuredClone(b.result.current.workspace!);
    act(() => {
      a.result.current.mutate((draft) => {
        draft.notes[0].title = "別のタブの変更";
      });
      window.dispatchEvent(new Event("pagehide"));
    });
    await waitFor(() => expect(a.result.current.status).toBe("saved"));
    await waitFor(() => expect(b.result.current.status).toBe("error"));
    expect(b.result.current.error).toContain("編集を停止");
    act(() =>
      b.result.current.mutate((draft) => {
        draft.notes[0].title = "上書きしない";
      }),
    );
    expect(b.result.current.workspace).toEqual(previous);
    expect((await storage.loadWorkspace()).workspace!.notes[0].title).toBe(
      "別のタブの変更",
    );
    a.unmount();
    b.unmount();
  });
});
