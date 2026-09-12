-- 揪團吃飯 v2：正規化資料表，避免單一 JSON 互相覆蓋
-- 請在 Supabase SQL Editor 整段執行

create extension if not exists pgcrypto;

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  face text not null,
  color text not null default 'white',
  created_at timestamptz not null default now()
);

create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.restaurant_menu (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  price numeric not null default 0,
  emoji text not null default '🍜',
  note text not null default '',
  sort_order int not null default 0
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_name text not null,
  icon text not null default '🍜',
  deadline_at timestamptz not null,
  closed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.order_menu (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  name text not null,
  price numeric not null default 0,
  emoji text not null default '🍜',
  note text not null default '',
  sort_order int not null default 0
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  person_id uuid references public.people(id) on delete set null,
  person_name text not null,
  menu_id uuid references public.order_menu(id) on delete set null,
  menu_name text not null,
  price numeric not null default 0,
  qty int not null default 1 check (qty > 0),
  note text not null default '',
  paid boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.order_versions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  action text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists order_menu_order_idx on public.order_menu (order_id);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_versions_order_idx on public.order_versions (order_id, created_at desc);
create index if not exists restaurant_menu_restaurant_idx on public.restaurant_menu (restaurant_id);

alter table public.people enable row level security;
alter table public.restaurants enable row level security;
alter table public.restaurant_menu enable row level security;
alter table public.orders enable row level security;
alter table public.order_menu enable row level security;
alter table public.order_items enable row level security;
alter table public.order_versions enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['people','restaurants','restaurant_menu','orders','order_menu','order_items','order_versions']
  loop
    execute format('drop policy if exists "public read %1$s" on public.%1$I', t);
    execute format('drop policy if exists "public write %1$s" on public.%1$I', t);
    execute format('create policy "public read %1$s" on public.%1$I for select to anon, authenticated using (true)', t);
    execute format('create policy "public write %1$s" on public.%1$I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.people;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.restaurants;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.restaurant_menu;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.order_menu;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.order_items;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.order_versions;
exception when duplicate_object then null;
end $$;
