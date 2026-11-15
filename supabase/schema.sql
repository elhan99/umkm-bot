-- Jalankan sekali di Supabase: SQL Editor > New query > paste > Run.
-- Bot memakai service_role key di server, jadi RLS diaktifkan TANPA policy:
-- artinya akses publik (anon key) ke semua tabel ditolak. Data tiap pengguna
-- dipisah lewat kolom user_id pada setiap query di backend.

create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  wa_id text not null unique,            -- ID WhatsApp (…@c.us atau …@lid)
  name text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  name text,
  product_type text,                     -- mis. keripik pisang, kue kering
  city text,
  owner_name text,
  updated_at timestamptz not null default now()
);

-- Progres tiap langkah: nib, pirt, halal, foto_produk, kemasan, label, shopee, tiktok_shop
create table if not exists progress_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  key text not null,
  status text not null default 'belum' check (status in ('belum','proses','selesai')),
  note text,
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);

create table if not exists product_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('foto','kemasan','label')),
  product_name text,
  score int check (score between 0 and 10),
  summary text,
  improvements text[],
  created_at timestamptz not null default now()
);
create index if not exists product_checks_user_idx on product_checks (user_id, created_at desc);

create table if not exists transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references users(id) on delete cascade,
  tx_date date not null,
  type text not null check (type in ('pemasukan','pengeluaran')),
  amount bigint not null check (amount > 0),   -- rupiah
  category text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists transactions_user_date_idx on transactions (user_id, tx_date);

create table if not exists messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_user_idx on messages (user_id, id desc);

alter table users          enable row level security;
alter table businesses     enable row level security;
alter table progress_items enable row level security;
alter table product_checks enable row level security;
alter table transactions   enable row level security;
alter table messages       enable row level security;

-- =====================================================================
-- Tambahan v2: pelacakan pesan, konten statis, info pengguna
-- (aman dijalankan ulang; bisa dijalankan di atas skema v1)
-- =====================================================================
alter table users add column if not exists phone text;
alter table users add column if not exists welcomed boolean not null default false;

-- Log pesan permanen untuk admin (TIDAK ikut terhapus saat pengguna mengetik "reset").
create table if not exists message_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references users(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  type text not null default 'text',            -- text | image | other
  body text not null,
  source text,                                  -- static | ai | system | error (khusus 'out')
  tokens_in int,
  tokens_out int,
  created_at timestamptz not null default now()
);
create index if not exists message_log_user_idx on message_log (user_id, id desc);
create index if not exists message_log_time_idx on message_log (id desc);
alter table message_log enable row level security;

-- Konten statis (panduan perizinan dll.). Dibaca bot lalu di-cache di memori;
-- bisa diedit dari halaman admin tanpa memakai AI.
create table if not exists static_content (
  key text primary key,
  title text not null,
  body text not null,
  version int not null default 1,
  customized boolean not null default false,    -- true bila diedit admin (tidak ditimpa update bawaan)
  updated_at timestamptz not null default now()
);
alter table static_content enable row level security;

-- Ringkasan per pengguna untuk halaman admin.
create or replace view user_overview with (security_invoker = true) as
select
  u.id, u.wa_id, u.phone, u.name, u.created_at, u.last_seen_at,
  b.name as business_name, b.product_type,
  (select count(*) from message_log m where m.user_id = u.id and m.direction = 'in')  as messages_in,
  (select count(*) from message_log m where m.user_id = u.id and m.direction = 'out') as messages_out,
  (select count(*) from transactions t where t.user_id = u.id) as tx_count,
  (select count(*) from progress_items p where p.user_id = u.id and p.status = 'selesai') as steps_done
from users u
left join businesses b on b.user_id = u.id;
revoke all on user_overview from anon, authenticated;
