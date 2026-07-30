-- TORIYAMA-iS / 店舗管理-iS Supabaseスキーマ（v2 フェーズ2・マルチテナント版）
-- 作成: 2026/07/28

-- 設計方針（店舗管理-iS 商品設計メモより）:
--   ・従業員マスタ / ICカードマッピング / 全社お知らせ は「同じ会社の全店舗で共有」
--     （掛け持ちスタッフの労働時間を法令通り通算するため、店舗ごとに分割しない）
--   ・打刻・シフト・在庫・売上報告・店内掲示板 は「店舗ごと」（store_id を必ず持つ）
--   ・打刻端末は店舗固定（クライアント側で store_id を選択させない。設置時に固定値として埋め込む）
--
-- マルチテナント化（2026/07/28追記）:
--   1つのSupabaseプロジェクト（Proプラン $25/月）の中に、鳥やま以外の複数の
--   顧客企業（会社）を同居させ、company_id で区切る。プロジェクトを顧客ごとに
--   増やすと $25×社数がそのまま原価に乗って月4,980円/店舗の粗利を圧迫するため、
--   1プロジェクト・マルチテナントが前提。全テーブルにcompany_idを持たせている
--   （store_id経由のJOINでも辿れるが、RLSをシンプルにするため直接持たせる設計）。
--
-- 重要な注意（未対応・要対応事項）:
--   1. 現状のログインはPIN/社員ID方式で、Supabase Authとは連携していない。
--      そのため下記の「demo_*」ポリシーは anonキーで誰でも読み書きできる緩い設定。
--      company_id列はあっても、認証で検証されていない限り「テナント分離」には
--      なっていない＝ブラウザの開発者ツールでCOMPANY_IDの値を書き換えれば
--      他社のデータも読み書きできてしまう。これは列を足しただけでは解決しない。
--      本番公開（＝2社目の顧客が乗る前）には、下の「本番用ポリシー例」のように
--      Supabase Auth（またはEdge Functions経由のAPIキー検証）でcompany_idを
--      サーバー側の検証済みクレームから取得する形に必ず差し替えること。
--   2. 残業・深夜・休日割増の計算ロジックは顧問社労士に確認してから確定させること。


-- ============================================================
-- 0. 会社マスタ（テナントの単位）
-- ============================================================
create table if not exists companies (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,          -- 例: 株式会社鶏やま
  code         text unique not null,   -- 例: toriyama（サブドメインやビルド識別に使う）
  plan         text not null default 'standard', -- 契約プラン（将来の課金管理用）
  created_at   timestamptz not null default now()
);

-- ============================================================
-- 1. 店舗マスタ（会社ごと・その会社の全店舗一覧）
-- ============================================================
create table if not exists stores (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  name         text not null,          -- 例: 餃子酒場さんちょうめ
  code         text not null,          -- 例: sanchome（会社内で一意）
  created_at   timestamptz not null default now(),
  unique (company_id, code)
);

-- ============================================================
-- 2. 従業員マスタ（会社の全店舗で共有・最重要データ）
-- ============================================================
create table if not exists employees (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  employee_code  text,                 -- 社員IDなど（社員のみ、会社内で一意）
  name           text not null,
  role           text not null check (role in ('baito', 'shain')),
  pin            text,                 -- デモ用の平文PIN。本番はハッシュ化必須。
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (company_id, employee_code)
);

-- 従業員がどの店舗で勤務できるか（掛け持ち対応。1人が複数店舗を持てる）
create table if not exists employee_store_access (
  employee_id  uuid not null references employees(id) on delete cascade,
  store_id     uuid not null references stores(id) on delete cascade,
  company_id   uuid not null references companies(id) on delete cascade,
  primary key (employee_id, store_id)
);

-- ICカードIDm ⇔ 従業員 の対応（会社内で共有。スマホSuicaは非対応のため物理カードのみ）
-- card_idはリーダーが読み取るIDmそのもの。異なる会社でIDmが衝突する可能性はほぼ無いが、
-- 念のため company_id を複合キーに含めている。
create table if not exists ic_cards (
  card_id        text not null,
  company_id     uuid not null references companies(id) on delete cascade,
  employee_id    uuid not null references employees(id) on delete cascade,
  registered_at  timestamptz not null default now(),
  primary key (company_id, card_id)
);

-- 本部お知らせ（会社の全店舗で共有）
create table if not exists announcements (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  body         text not null,
  image_url    text,
  posted_by    uuid references employees(id),
  posted_at    timestamptz not null default now()
);


-- ============================================================
-- 3. 打刻（店舗ごと・払金計算に直結するため最重要＋オフラインキュー必須）
-- ============================================================
create table if not exists punches (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  employee_id  uuid not null references employees(id),
  store_id     uuid not null references stores(id),
  type         text not null check (type in ('in', 'out', 'break_start', 'break_end')),
  punched_at   timestamptz not null,   -- 実際に打刻された時刻（オフライン時は端末側の時刻）
  synced_at    timestamptz not null default now(), -- サーバーに届いた時刻
  source       text not null default 'card' check (source in ('card', 'offline_queue')),
  created_at   timestamptz not null default now()
);
create index if not exists idx_punches_employee_date on punches (employee_id, punched_at);
create index if not exists idx_punches_store_date on punches (store_id, punched_at);
create index if not exists idx_punches_company on punches (company_id);

-- ============================================================
-- 4. シフト（店舗ごと）
-- ============================================================
create table if not exists shift_requests (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  employee_id  uuid not null references employees(id),
  store_id     uuid not null references stores(id),
  work_date    date not null,
  start_time   time,
  end_time     time,
  is_off       boolean not null default false,
  submitted_at timestamptz not null default now()
);

create table if not exists shift_confirmed (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  employee_id   uuid not null references employees(id),
  store_id      uuid not null references stores(id),
  work_date     date not null,
  start_time    time,
  end_time      time,
  is_off        boolean not null default false,
  confirmed_by  uuid references employees(id),
  confirmed_at  timestamptz not null default now()
);

-- ============================================================
-- 5. 在庫（店舗ごと）
-- ============================================================
create table if not exists inventory_items (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  store_id    uuid not null references stores(id),
  category    text not null,
  name        text not null,
  qty_label   text not null,   -- "3.2kg" のような表示用文字列（デモは数値厳密化しない）
  status      text not null check (status in ('要発注', 'やや少', '十分')),
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- 6. 売上報告（店舗ごと）
-- ============================================================
create table if not exists sales_reports (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  store_id      uuid not null references stores(id),
  report_date   date not null,
  sales_amount  integer not null,
  guest_count   integer,
  memo          text,
  submitted_by  uuid references employees(id),
  submitted_at  timestamptz not null default now()
);

-- ============================================================
-- 7. 店内掲示板（店舗ごと。会社全体共有のannouncementsとは別物）
-- ============================================================
create table if not exists board_posts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  store_id    uuid not null references stores(id),
  body        text not null,
  image_url   text,
  posted_by   uuid references employees(id),
  posted_at   timestamptz not null default now()
);

create table if not exists board_reads (
  post_id      uuid not null references board_posts(id) on delete cascade,
  employee_id  uuid not null references employees(id) on delete cascade,
  read_at      timestamptz not null default now(),
  primary key (post_id, employee_id)
);


-- ============================================================
-- RLS（現時点はデモ用の緩い設定。本番前に要差し替え）
-- ============================================================
alter table companies enable row level security;
alter table stores enable row level security;
alter table employees enable row level security;
alter table employee_store_access enable row level security;
alter table ic_cards enable row level security;
alter table announcements enable row level security;
alter table punches enable row level security;
alter table shift_requests enable row level security;
alter table shift_confirmed enable row level security;
alter table inventory_items enable row level security;
alter table sales_reports enable row level security;
alter table board_posts enable row level security;
alter table board_reads enable row level security;

-- --- デモ用ポリシー（今はこちらが有効。anonキーで全社・全店舗を読み書き可） ---
create policy "demo_all_access" on companies for all using (true) with check (true);
create policy "demo_all_access" on stores for all using (true) with check (true);
create policy "demo_all_access" on employees for all using (true) with check (true);
create policy "demo_all_access" on employee_store_access for all using (true) with check (true);
create policy "demo_all_access" on ic_cards for all using (true) with check (true);
create policy "demo_all_access" on announcements for all using (true) with check (true);
create policy "demo_all_access" on punches for all using (true) with check (true);
create policy "demo_all_access" on shift_requests for all using (true) with check (true);
create policy "demo_all_access" on shift_confirmed for all using (true) with check (true);
create policy "demo_all_access" on inventory_items for all using (true) with check (true);
create policy "demo_all_access" on sales_reports for all using (true) with check (true);
create policy "demo_all_access" on board_posts for all using (true) with check (true);
create policy "demo_all_access" on board_reads for all using (true) with check (true);

-- --- 本番用ポリシー例（コメントアウト。Supabase Authを導入し、ログイン時に
--     employees.company_id を app_metadata.company_id としてJWTに埋め込んでから、
--     上のdemo_*ポリシーをdropしてこちらに切り替える） ---
--
-- drop policy "demo_all_access" on punches;
-- create policy "tenant_isolation" on punches for all
--   using (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid)
--   with check (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid);
-- （他のテーブルも同じ形でcompany_idを比較するポリシーに置き換える）


-- ============================================================
-- 初期データ（鳥やま1社・5店舗・仮データ）
-- ============================================================
insert into companies (name, code) values
  ('株式会社鶏やま', 'toriyama')
on conflict (code) do nothing;

insert into stores (company_id, name, code)
select c.id, s.name, s.code
from companies c
cross join (values
  ('餃子酒場さんちょうめ', 'sanchome'),
  ('鳥料理と炭火焼 鶏やま', 'keiyama'),
  ('Tripot cafe BAKE stand', 'tripot-bake'),
  ('Tripot cafe FOOD truck ①', 'tripot-truck1'),
  ('Tripot cafe FOOD truck ②', 'tripot-truck2')
) as s(name, code)
where c.code = 'toriyama'
on conflict (company_id, code) do nothing;

-- 仮の従業員データ（現在のテスト画面のバイト/社員選択肢と合わせている）
insert into employees (company_id, name, role, pin)
select c.id, e.name, e.role, e.pin
from companies c
cross join (values
  -- 社員
  ('田中', 'shain', '0000'),
  ('佐藤', 'shain', '0000'),
  ('鈴木', 'shain', '0000'),
  ('伊藤', 'shain', '0000'),
  ('加藤', 'shain', '0000'),
  ('中村', 'shain', '0000'),
  -- バイト
  ('山田', 'baito', '1234'),
  ('高橋', 'baito', '1234'),
  ('中島', 'baito', '1234'),
  ('岡本', 'baito', '1234'),
  ('松本', 'baito', '1234'),
  ('木村', 'baito', '1234'),
  ('斎藤', 'baito', '1234'),
  ('渡部', 'baito', '1234'),
  ('渡辺', 'baito', '1234'),
  ('石井', 'baito', '1234'),
  ('小林', 'baito', '1234'),
  ('森田', 'baito', '1234')
) as e(name, role, pin)
where c.code = 'toriyama';
