import { useEffect, useRef, useState } from "react";
import {
  HardDrive,
  Download,
  Upload,
  ShieldCheck,
  Sparkles,
  ArrowUpRight,
  BookOpen,
} from "lucide-react";
import type { Workspace } from "../core/types";
import { downloadBackup, parseBackup } from "../core/import";
import Modal from "./Modal";

interface SettingsDialogProps {
  workspace: Workspace;
  onClose: () => void;
  onNotify: (message: string) => void;
  onRestore: (candidate: Workspace) => Promise<void>;
  onOpenAi: () => void;
}

export default function SettingsDialog({
  workspace,
  onClose: close,
  onNotify: notify,
  onRestore,
  onOpenAi,
}: SettingsDialogProps) {
  const [restoreText, setRestoreText] = useState("");
  const [backupCandidate, setBackupCandidate] = useState<Workspace | null>(
    null,
  );
  const [storage, setStorage] = useState("");
  const [offlineReady, setOfflineReady] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const mounted = useRef(true),
    requestId = useRef(0);
  useEffect(() => {
    mounted.current = true;
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      void navigator.serviceWorker.ready.then(() => {
        if (mounted.current) setOfflineReady(true);
      });
    }
    void navigator.storage
      ?.estimate?.()
      .then((estimate) => {
        if (mounted.current)
          setStorage(
            ((estimate.usage || 0) / 1024 / 1024).toFixed(1) + " MB 使用中",
          );
      })
      .catch(() => {
        if (mounted.current) setStorage("使用量を取得できません");
      });
    return () => {
      mounted.current = false;
      requestId.current++;
    };
  }, []);
  const previewBackup = async (file: File) => {
    const request = ++requestId.current;
    try {
      const candidate = await parseBackup(await file.text());
      if (!mounted.current || request !== requestId.current) return;
      setRestoreText(file.name);
      setBackupCandidate(candidate);
    } catch (error) {
      if (mounted.current && request === requestId.current)
        notify("復元できません：" + (error as Error).message);
    }
  };
  const applyBackup = async () => {
    if (!backupCandidate || restoring) return;
    setRestoring(true);
    try {
      await onRestore(backupCandidate);
    } catch (error) {
      if (mounted.current)
        notify("復元に失敗しました：" + (error as Error).message);
    } finally {
      if (mounted.current) setRestoring(false);
    }
  };
  const backup = async () => {
    try {
      await downloadBackup(workspace);
      notify("バックアップをダウンロードしました");
    } catch (error) {
      notify("バックアップできません：" + (error as Error).message);
    }
  };
  const requestPersistence = async () => {
    try {
      const ok = await navigator.storage?.persist?.();
      notify(
        ok
          ? "永続ストレージが有効になりました"
          : "このブラウザでは永続ストレージの許可を取得できません。バックアップをお使いください。",
      );
    } catch {
      notify(
        "保存領域の保持を要求できませんでした。バックアップをお使いください。",
      );
    }
  };
  return (
    <Modal title="設定とバックアップ" onClose={close} wide>
      <div className="settings-info">
        <span className="settings-icon">
          <HardDrive size={25} />
        </span>
        <div>
          <h3>あなたのノートは、この端末に。</h3>
          <p>ノート・原本・画像・履歴をブラウザのIndexedDBに保存します。</p>
          <small>
            {storage} · {workspace.notes.length}件のノート · 同期は未接続
          </small>
        </div>
      </div>
      <div className="settings-section">
        <h3>バックアップと復元</h3>
        <p>
          ブラウザのデータ削除や端末の変更に備え、定期的にファイルを保存してください。PCとiPhoneでの受け渡しにも使えます。
        </p>
        <div className="settings-buttons">
          <button className="primary" onClick={() => void backup()}>
            <Download size={16} />
            全データをバックアップ
          </button>
          <label className="secondary file-button">
            <Upload size={16} />
            バックアップを選ぶ
            <input
              type="file"
              accept=".json"
              onChange={(e) => {
                if (e.target.files?.[0]) previewBackup(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {backupCandidate && (
          <div className="restore-preview">
            <strong>「{restoreText}」を復元</strong>
            <p>
              ノート {backupCandidate.notes.length}件 / フォルダ{" "}
              {backupCandidate.folders.length}
              件。現在のデータを置き換えます。実行時に現在のバックアップも保存します。
            </p>
            <button
              className="secondary"
              onClick={() => setBackupCandidate(null)}
            >
              キャンセル
            </button>{" "}
            <button
              className="primary"
              disabled={restoring}
              onClick={() => void applyBackup()}
            >
              この内容で復元する
            </button>
          </div>
        )}
      </div>
      <div className="settings-section">
        <h3>保存領域</h3>
        <p>
          端末が対応している場合、保存データが自動削除されにくくなるように要求できます。バックアップも併用してください。
        </p>
        <button className="secondary" onClick={() => void requestPersistence()}>
          <ShieldCheck size={16} />
          保存領域の保持を要求
        </button>
      </div>
      <div className="settings-section integration-setting">
        <Sparkles size={20} />
        <div>
          <h3>AIによる変更提案</h3>
          <p>
            JSONの変更案を確認して適用します。ChatGPT直接連携・端末間の自動同期は未接続です。
          </p>
          <button className="text-action" onClick={onOpenAi}>
            変更提案を開く <ArrowUpRight size={14} />
          </button>
        </div>
      </div>
      <div className="settings-section">
        <h3>iPhoneでアプリとして使う</h3>
        <p className="offline-readiness" role="status">
          {offlineReady
            ? "✓ オフライン準備完了"
            : !import.meta.env.PROD
              ? "開発モード（オフライン未準備）"
              : !("serviceWorker" in navigator)
                ? "このブラウザではオフライン起動に対応していません"
                : "オフライン用ファイルを準備しています…"}
        </p>
        <p>
          Safariで公開URLを開き、共有ボタン
          →「ホーム画面に追加」→「追加」。最初はオンラインで開いてください。設定内のSafariとホーム画面では、保存領域が異なる場合があります。
        </p>
      </div>
      <div className="about-line">
        <BookOpen size={15} />
        <strong>Folio</strong>
        <span>1.0.0 · ひらめきを、育つ知識に。</span>
      </div>
    </Modal>
  );
}
