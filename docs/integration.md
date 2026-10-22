# ChatGPT と変更 API

## いま使える範囲

このアプリは端末内で動く静的 PWA です。ChatGPT から端末の IndexedDB へ直接接続することはできません。API キーを埋め込まず、外部にノートを書き換える公開エンドポイントも設置していません。

現在は、回答の貼り付け・ファイル取り込みと、手動で持ち込む JSON 変更提案を使えます。「AI 変更提案」は実際の AI 呼び出しではありません。ChatGPT 等に JSON を作ってもらい、アプリで内容を確認して適用するためのローカル機能です。生成した内容が正しいことまでは保証しないため、適用前に変更対象と内容を確認します。適用したノート変更は編集履歴と Undo で戻せます。

## 公式仕様の確認（2026 年 10 月 22 日）

OpenAI の公式案内では、ChatGPT のカスタム MCP サーバーはプラグインとして読み取り・書き込みツールを公開できます。SSE と streaming HTTP、および OAuth 認証の選択肢が記載されています。ワークスペース権限やセキュリティ設定による制限があり、個々のアカウントで利用できるかはその設定画面で確認する必要があります。[公式: Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server)

この仕様を踏まえると、将来は「同期サーバーへ認証して接続する MCP プラグイン」として実現できます。今回のコードだけで MCP 接続が完了しているという意味ではありません。

## ローカル API

`src/core/ai.ts` は UI と通信方式から分離したドメイン API です。

| API | 操作 |
| --- | --- |
| `listFolders()` | フォルダ一覧を取得 |
| `listNotes(folderId?)` | ゴミ箱を除くノートを取得 |
| `getNote(noteId)` | ノートの内容と更新日時を取得 |
| `createFolder(input)` | フォルダを作成 |
| `createNote(input)` | ノートを作成 |
| `editNote(id, expectedUpdatedAt, patch)` | タイトル・タグ・ピン・お気に入り等を変更 |
| `appendNote(id, expectedUpdatedAt, blocks)` | 末尾に追記 |
| `moveNote(id, expectedUpdatedAt, folderId)` | ノートを移動 |
| `addBlocks(id, expectedUpdatedAt, blocks, index?)` | ブロック追加 |
| `editBlocks(id, expectedUpdatedAt, edits)` | 複数ブロックの編集 |
| `moveBlocks(sourceId, token, blockIds, targetId, targetToken, index?)` | 同一・別ノートへの一括移動 |
| `batch(operations)` | 一連の操作を検証して、全体のプレビューを取得 |
| `snapshot()` | 操作後データのコピーを取得 |

API インスタンスは渡されたデータのコピーに対して動作し、保存は呼び出し側が行います。読み取り結果もコピーのため、戻り値の変更で元データを書き換えることはできません。`batch` は途中で失敗すると全操作を取り消します。既存ノートへの変更には `expectedUpdatedAt` が必要で、読み取り後にノートが更新されていれば拒否します。ブロック移動は移動先の日時も確認します。

## JSON の形式

説明文や Markdown のコードフェンスを付けず、JSON だけを入力します。

```json
{
  "version": 1,
  "operations": [
    {
      "op": "create_folder",
      "id": "history",
      "name": "日本史"
    },
    {
      "op": "create_note",
      "title": "平安時代のまとめ",
      "folderId": "history",
      "tags": ["歴史"],
      "blocks": [
        { "type": "heading", "html": "<h2>平安時代</h2>" },
        { "type": "text", "html": "<p>ここに保存する回答を入れます。</p>" }
      ]
    }
  ]
}
```

既存ノートの編集例です。`noteId` と `expectedUpdatedAt` は実際の対象から取得した値に置き換えます。

```json
{
  "version": 1,
  "operations": [
    {
      "op": "append_note",
      "noteId": "実際のノートID",
      "expectedUpdatedAt": "2026-10-22T09:00:00.000Z",
      "blocks": [{ "type": "text", "html": "<p>補足する内容。</p>" }]
    }
  ]
}
```

同じ提案内で同一ノートを複数回変更する場合は、提案作成時の同じ更新日時を使います。適用時にも現在のワークスペースに対して再検証します。ブロックは `text` / `heading` / `image` / `table` / `code` / `quote` / `divider` / `math` / `html` を使えます。HTML は取り込みと同じ規則で無害化します。画像の幅は 10〜100 % です。

対応する操作は `create_folder`、`rename_folder`、`move_folder`、`create_note`、`edit_note`、`append_note`、`move_note`、`add_blocks`、`edit_block`、`delete_blocks`、`move_blocks`、`trash_note` です。ノートを完全に消去する操作は公開していません。未知の操作・項目や、存在しない対象、フォルダ循環、重複 ID、不正な画像 URL は拒否します。

提案の上限は 16 MB、1,000 操作、1 操作あたり 500 ブロックです。巨大な画像入り提案は、通常のファイル取り込みに分けてください。

## 将来の直接連携

次の順に追加すれば、現在の UI と保存形式を生かして拡張できます。

1. IndexedDB の保存層に同期アダプターを追加し、利用者ごとの暗号化通信と認証付きサーバー保存を用意します。GitHub Pages は UI 配信に使い続けられます。
2. OAuth で本人確認し、各ツールの実行時に所有者・権限・更新日時を検証します。読み取り権限と書き込み権限を分け、クライアントに API 秘密鍵を置きません。
3. サーバーに同じ操作スキーマと一括処理・監査記録・履歴復元を実装します。端末間競合は上書きせず、競合コピーや解決画面へ渡します。
4. MCP には `list_folders`、`list_notes`、`get_note`、`preview_changes`、`apply_changes` 等を公開します。書き込み前に差分を利用者へ示し、承認した提案 ID と期限で適用します。
5. ChatGPT 側でカスタム MCP サーバーを登録し、本人の OAuth 接続とテスト用ノートで検証します。公開先と必要な料金は導入時に決めます。

今回の実装は 1〜5 を実施した状態ではありません。有料サービスの契約、OpenAI API の呼び出し、API キーの作成も行っていません。
