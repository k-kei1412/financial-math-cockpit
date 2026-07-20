# 金融数学 研究コックピット

複数人でリアルタイムに同時編集・同期しながら作業できる、研究ログ＆数式管理Webアプリのプロトタイプです。
ビルド不要の素のHTML/CSS/JavaScriptで作られており、GitHub Pagesにそのまま公開できます。

- 数式レンダリング: [KaTeX](https://katex.org/)
- リアルタイム同期・データ保存: [Supabase](https://supabase.com/)（Postgres + Realtime）

## ファイル構成

```
financial-math-cockpit/
├── index.html          # 画面全体（3エリア構成）
├── style.css           # スタイル
├── app.js              # アプリロジック（Supabase連携・KaTeXレンダリング）
├── config.js           # Supabaseの接続情報（要編集）
└── supabase/
    └── schema.sql       # テーブル定義＋初期データ投入SQL
```

---

## セットアップ手順（最短ルート）

### ステップ1: Supabaseプロジェクトを作成する

1. https://supabase.com にアクセスし、無料でサインアップ（GitHubアカウントでログイン可）。
2. 「New Project」から新規プロジェクトを作成（リージョンは `Northeast Asia (Tokyo)` 推奨）。
3. プロジェクト作成完了まで1〜2分待つ。

### ステップ2: テーブルを作成する

1. Supabaseダッシュボード左メニューの **SQL Editor** を開く。
2. このリポジトリの `supabase/schema.sql` の中身を全てコピーし、SQL Editorに貼り付けて **Run** を実行。
3. 左メニューの **Table Editor** で `tasks` / `formulas` / `research_logs` / `chat_messages` / `shared_draft` の5テーブルが作成され、公式のサンプルデータが入っていることを確認する。

### ステップ3: 接続情報を取得し `config.js` を編集する

1. Supabaseダッシュボードの **Project Settings > API** を開く。
2. `Project URL` と `anon public` キーをコピーする。
3. このリポジトリの `config.js` を開き、以下を書き換える。

```js
window.SUPABASE_CONFIG = {
  url: "https://xxxxxxxxxxxx.supabase.co",
  anonKey: "eyJhbGciOi....（長い文字列）",
};
```

### ステップ4: GitHubにリポジトリを作成してPushする

開発環境がない場合は、GitHubのWeb画面から直接ファイルをアップロードするだけでもOKです。

1. GitHubで新規リポジトリを作成（例: `financial-math-cockpit`）。Publicにする（GitHub Pages無料利用のため）。
2. リポジトリの「Add file > Upload files」から、このフォルダ内の全ファイル（`index.html`, `style.css`, `app.js`, `config.js`, `supabase/`フォルダ）をドラッグ＆ドロップしてアップロード。
3. コミットして完了。

（Gitに慣れている場合は通常通り `git init` → `git add .` → `git commit` → `git remote add origin ...` → `git push` でもOK。）

### ステップ5: GitHub Pagesを有効化する

1. リポジトリの **Settings > Pages** を開く。
2. 「Build and deployment」の Source を `Deploy from a branch` にし、Branch を `main` / `/ (root)` に設定して **Save**。
3. 数十秒〜数分待つと、ページ上部に公開URL
   `https://<あなたのGitHubユーザー名>.github.io/financial-math-cockpit/`
   が表示される。

### ステップ6: メンバーに共有する（複数人での使い方）

1. 上記URLをZOOMのチャットやSlack等で共有するだけです。開発環境のないメンバーもブラウザでアクセスするだけで使えます（アカウント登録・ログイン不要）。
2. 各メンバーは画面右上の「変更」ボタンから自分の表示名を設定します。これはブラウザのlocalStorageに保存される単なる名札で、タスクの担当者名やログ・チャットの発言者名として使われます（他人と区別するためのものなので、他のメンバーと名前が被らないようにしてください）。
3. あとは全員が同じURLを開いておくだけで、タスク・公式・チームチャット・作業ログが全員の画面にリアルタイムで同期されます。ZOOM画面共有で1人が操作するのではなく、各自が自分のブラウザで直接編集・閲覧できます。
4. 現状はURLを知っている人なら誰でも読み書きできるオープンな設定です。学内の少人数チームなど、信頼できるメンバー間での利用を想定しています。

---

## 使い方

- **上部（チームチャット）**: メンバー間の簡単な連絡用リアルタイムチャット。ZOOM等と併用し、作業連絡や質問に使えます。
- **左側（公式ライブラリ）**: キーワードで公式を検索し、「コピー」ボタンで `$`/`$$` を除去した純粋なLaTeXコードをクリップボードにコピー。「スプレッドシート貼り付けモード」を有効にすると先頭に `'` を付与してコピーします（Googleスプレッドシートで数式として誤解釈されるのを防止）。新しい公式もフォームから登録可能。
- **右側（作業ログ）**: 左半分に入力したテキスト（`$...$` や `$$...$$` で囲んだLaTeX含む）が、右半分にKaTeXで整形されてリアルタイムプレビューされます。入力内容は全員の画面にリアルタイム共有され（Last-Write-Wins方式）、「ログとして保存」ボタンで確定版を研究ログ履歴に保存できます。保存済みログは履歴から削除もできます（削除前に確認ダイアログが出ます）。
- **下部（タスク管理）**: タスクを追加・担当者設定・ステータス変更（未着手／進行中／完了）。変更は即座に全員へ反映。削除前には確認ダイアログが出ます。

## 既知の制約・今後の拡張余地

- 右側の共同編集は簡易的な Last-Write-Wins 方式です（Google Docsのような文字単位のリアルタイム共同編集ではありません）。同時に同じ場所を編集すると後勝ちで上書きされます。より高度な共同編集が必要な場合は、Yjs等のCRDTライブラリの導入を検討してください。
- 現状はSupabase Authを使わず、anonキー＋オープンなRLSポリシーで全員が読み書き可能な設計です（学内の少人数チーム利用を想定）。学外への公開や、ユーザーごとのアクセス制御が必要になった場合はSupabase Authの導入を推奨します。
- Googleスプレッドシートとの直接連携（Apps Script等によるAPI同期）は今回のプロトタイプ範囲には含めていません。現状はコピペ運用（コピーボタン→スプレッドシートに貼り付け）を前提としています。
