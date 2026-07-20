-- ============================================================
-- 金融数学研究用コックピット - Supabase スキーマ定義
-- Supabase ダッシュボード > SQL Editor に貼り付けて実行してください。
-- ============================================================

-- 拡張機能（UUID生成用。Supabaseプロジェクトでは通常デフォルトで有効）
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1. タスク管理テーブル
-- ------------------------------------------------------------
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  assignee    text default '未定',
  status      text not null default '未着手'
              check (status in ('未着手', '進行中', '完了')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz  -- 論理削除（誤削除からの復元用。管理者のゴミ箱に表示）
);

-- ------------------------------------------------------------
-- 2. 公式マスタテーブル
-- ------------------------------------------------------------
create table if not exists public.formulas (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  latex       text not null,        -- 区切り記号 $ / $$ を含まない純粋なLaTeXコード
  category    text default '未分類',
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ------------------------------------------------------------
-- 3. 研究ログテーブル（確定保存された作業ログの履歴）
-- ------------------------------------------------------------
create table if not exists public.research_logs (
  id          uuid primary key default gen_random_uuid(),
  author      text default '匿名',
  content     text not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ------------------------------------------------------------
-- 4. チームチャットテーブル
-- ------------------------------------------------------------
create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  author      text default '匿名',
  content     text not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ------------------------------------------------------------
-- 5. 共有ドラフトテーブル（右側入力欄のリアルタイム共同編集用の単一行）
--    複数人が同時にタイプした内容を最新の書き込みで共有するシンプルな
--    Last-Write-Wins方式。厳密な共同編集（CRDT/OT）はスコープ外。
-- ------------------------------------------------------------
create table if not exists public.shared_draft (
  id          int primary key default 1,
  content     text not null default '',
  updated_by  text default '匿名',
  updated_at  timestamptz not null default now(),
  constraint single_row check (id = 1)
);

insert into public.shared_draft (id, content)
values (1, '')
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- updated_at 自動更新トリガー
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_tasks_updated_at on public.tasks;
create trigger trg_tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

drop trigger if exists trg_shared_draft_updated_at on public.shared_draft;
create trigger trg_shared_draft_updated_at
  before update on public.shared_draft
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- Realtime 有効化（テーブル変更をクライアントへブロードキャスト）
-- ------------------------------------------------------------
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.formulas;
alter publication supabase_realtime add table public.research_logs;
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.shared_draft;

-- ------------------------------------------------------------
-- Row Level Security
-- 学内の少人数チーム利用を想定し、anonキーからの読み書きを許可する
-- オープンな設定にしています。学外公開や機密情報を扱う場合は、
-- Supabase Authを導入しユーザー単位のポリシーに置き換えてください。
-- ------------------------------------------------------------
alter table public.tasks         enable row level security;
alter table public.formulas      enable row level security;
alter table public.research_logs enable row level security;
alter table public.chat_messages enable row level security;
alter table public.shared_draft  enable row level security;

create policy "anon full access - tasks"
  on public.tasks for all
  using (true) with check (true);

create policy "anon full access - formulas"
  on public.formulas for all
  using (true) with check (true);

create policy "anon full access - research_logs"
  on public.research_logs for all
  using (true) with check (true);

create policy "anon full access - chat_messages"
  on public.chat_messages for all
  using (true) with check (true);

create policy "anon full access - shared_draft"
  on public.shared_draft for all
  using (true) with check (true);

-- ============================================================
-- 初期データ投入
-- ============================================================

insert into public.tasks (title, assignee, status) values
  ('ブラック・ショールズ方程式の導出レビュー', '田中', '進行中'),
  ('伊藤の公式の応用例まとめ', '佐藤', '未着手'),
  ('中間発表スライド作成', '鈴木', '未着手');

insert into public.formulas (name, latex, category) values
  (
    'ブラック・ショールズ方程式',
    '\frac{\partial V}{\partial t} + \frac{1}{2}\sigma^2 S^2 \frac{\partial^2 V}{\partial S^2} + rS\frac{\partial V}{\partial S} - rV = 0',
    '偏微分方程式'
  ),
  (
    '伊藤の公式',
    'df(X_t, t) = \left(\frac{\partial f}{\partial t} + \mu \frac{\partial f}{\partial x} + \frac{1}{2}\sigma^2 \frac{\partial^2 f}{\partial x^2}\right)dt + \sigma \frac{\partial f}{\partial x} dW_t',
    '確率解析'
  ),
  (
    '幾何ブラウン運動（確率微分方程式）',
    'dS_t = \mu S_t\,dt + \sigma S_t\,dW_t',
    '確率微分方程式'
  ),
  (
    'フーリエ変換',
    '\hat{f}(\xi) = \int_{-\infty}^{\infty} f(x)\, e^{-2\pi i x \xi}\, dx',
    'フーリエ解析'
  ),
  (
    'リスク中立評価式',
    'V_0 = e^{-rT}\, \mathbb{E}^{\mathbb{Q}}\!\left[\, \max(S_T - K,\, 0) \,\right]',
    'オプション評価'
  ),
  (
    'オルンシュタイン・ウーレンベック過程',
    'dX_t = \theta(\mu - X_t)\,dt + \sigma\,dW_t',
    '確率過程'
  );

insert into public.research_logs (author, content) values
  ('システム', '研究ログの記録を開始しました。右側の入力欄に作業内容や数式を記入し、「ログとして保存」ボタンで確定保存できます。');

insert into public.chat_messages (author, content) values
  ('システム', 'チームチャットへようこそ。ここでの会話もリアルタイムで全員に共有されます。');
