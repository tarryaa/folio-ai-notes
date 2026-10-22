import { uid, type Note, type Workspace, type Block } from "./types";

export function createNote(folderId: string | null = null): Note {
  const now = new Date().toISOString();
  return {
    id: uid(),
    title: "無題のノート",
    folderId,
    tags: [],
    favorite: false,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    order: Date.now(),
    blocks: [{ id: uid(), type: "text", html: "<p></p>" }],
    originals: [],
    revisions: [],
  };
}

const block = (type: Block["type"], html?: string): Block => ({
  id: uid(),
  type,
  ...(html !== undefined ? { html } : {}),
});

export function seedWorkspace(): Workspace {
  const now = new Date().toISOString();
  const make = (
    id: string,
    title: string,
    folderId: string | null,
    tags: string[],
    blocks: Block[],
    order: number,
  ): Note => ({
    ...createNote(folderId),
    id,
    title,
    tags,
    blocks,
    order,
    createdAt: now,
    updatedAt: now,
  });
  return {
    schemaVersion: 1,
    folders: [
      { id: "folder-history", name: "日本史", parentId: null, order: 0 },
      { id: "folder-ideas", name: "アイデア", parentId: null, order: 1 },
      { id: "folder-work", name: "仕事", parentId: null, order: 2 },
    ],
    notes: [
      {
        ...make(
          "welcome",
          "AIの回答を、使える知識に。",
          null,
          ["はじめに", "使い方"],
          [
            block(
              "text",
              "<p>ひらめいたことも、深く学んだことも。<br>Folioは、AIとの対話から生まれた知識を、あなたの手元に残す場所です。</p>",
            ),
            block(
              "html",
              '<div style="background-color:#f5f8f5;border:1px solid #e5ece5;border-radius:12px;padding:20px 24px"><p style="margin:0;font-size:14px;color:#477055"><strong>✦ あなたの知識の、小さな書斎。</strong></p><p style="margin:8px 0 0;font-size:14px;line-height:1.8;color:#68716b">回答を貼り付けて、整えて、つなげる。保存した情報を、次のアイデアの出発点に。</p></div>',
            ),
            block("heading", "<h2>残したい形で、保存する</h2>"),
            block(
              "text",
              "<p>ChatGPTの回答をコピーして、そのままノートに貼り付けてみてください。見出し、リスト、表、コードなどの書式を受け取り、ブロックごとに編集できます。</p>",
            ),
            block(
              "table",
              "<table><thead><tr><th>保存のしかた</th><th>こんなときに</th><th>できること</th></tr></thead><tbody><tr><td><strong>編集可能モード</strong></td><td>内容を育てていきたい</td><td>文章・表の編集、並べ替え、再利用</td></tr><tr><td><strong>原本保存モード</strong></td><td>見た目をそのまま残したい</td><td>元画像の保持、拡大、画像上の注釈</td></tr></tbody></table>",
            ),
            block("heading", "<h2>知識を、少しずつ育てる</h2>"),
            block(
              "text",
              "<ul><li><strong>整理する</strong> — フォルダやタグで、迷わず見つける。</li><li><strong>編集する</strong> — 文章を直す。表を書き換える。ブロックを動かす。</li><li><strong>つなげる</strong> — 必要な部分を選んで、別のノートへ。</li><li><strong>守る</strong> — 自動保存に加えて、大切な内容はバックアップへ。</li></ul>",
            ),
            block(
              "quote",
              "<blockquote><p>集めるだけで終わらせない。<br>読み返すたびに、少しだけ自分の知識になる。</p></blockquote>",
            ),
            block(
              "text",
              '<p style="font-size:13px;color:#93958f">このノートも自由に編集できます。左上の「新規ノート」から、最初の一冊をはじめましょう。</p>',
            ),
          ],
          0,
        ),
        pinned: true,
        favorite: true,
      },
      {
        ...make(
          "history-guide",
          "江戸時代の流れをつかむ",
          "folder-history",
          ["学習", "日本史"],
          [
            block(
              "text",
              "<p>約260年続いた江戸時代を、「成立 → 安定 → 変化」の3つの視点で読み解く。</p>",
            ),
            block("heading", "<h2>時代を動かした3つの転換点</h2>"),
            block(
              "table",
              "<table><thead><tr><th>時期</th><th>主な動き</th><th>読み解くポイント</th></tr></thead><tbody><tr><td>17世紀</td><td>幕藩体制の確立</td><td>大名統制と社会秩序の形成</td></tr><tr><td>18世紀</td><td>商品経済の発達・幕政改革</td><td>都市の成長と財政の課題</td></tr><tr><td>19世紀</td><td>開国・幕末の政治変動</td><td>外交問題と国内政治の接続</td></tr></tbody></table>",
            ),
            block(
              "quote",
              "<blockquote>出来事の年号だけでなく、「なぜ、その変化が起きたのか」を自分の言葉でまとめる。</blockquote>",
            ),
            block("heading", "<h2>次に調べたいこと</h2>"),
            block(
              "text",
              "<ul><li>参勤交代は地域経済にどんな影響を与えたか</li><li>江戸と大阪では、都市の役割がどう違ったか</li><li>幕政改革で繰り返し取り組まれた課題は何か</li></ul>",
            ),
          ],
          1,
        ),
        favorite: true,
      },
      make(
        "ideas-notebook",
        "小さなアイデアの種",
        "folder-ideas",
        ["アイデア"],
        [
          block(
            "text",
            "<p>まだ形になっていない思いつきを、気軽に置いておく場所。</p>",
          ),
          block("heading", "<h2>週末の「知識をつなぐ」時間</h2>"),
          block(
            "text",
            "<ol><li>今週保存したノートを3つ選ぶ。</li><li>共通しているテーマをひとつ見つける。</li><li>そのテーマから、新しい問いをつくる。</li></ol>",
          ),
          block(
            "html",
            '<div style="background-color:#faf7ef;border-radius:12px;padding:20px"><p style="margin:0"><strong>問いのストック</strong><br>「便利だった」で終わらせず、明日の自分がどう使えるかを考えてみる。</p></div>',
          ),
        ],
        2,
      ),
      make(
        "work-weekly",
        "今週のふりかえり",
        "folder-work",
        ["仕事", "ふりかえり"],
        [
          block(
            "text",
            "<p>忙しい毎日の中で、できたことと学んだことを見える形に。</p>",
          ),
          block("heading", "<h2>今週できたこと</h2>"),
          block(
            "text",
            "<ul><li>情報を一か所に集める仕組みをつくった。</li><li>打ち合わせのメモを整理して共有した。</li><li>次の企画に使えそうな視点を見つけた。</li></ul>",
          ),
          block("heading", "<h2>来週の自分へのメモ</h2>"),
          block(
            "text",
            "<p>大きなタスクは、最初の15分で取り組める単位に分けてみる。調べたことは、出典と一緒に残しておく。</p>",
          ),
        ],
        3,
      ),
    ],
  };
}
