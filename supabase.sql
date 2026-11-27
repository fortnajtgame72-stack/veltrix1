create table if not exists scripts(
 id uuid primary key default gen_random_uuid(),
 title text not null, description text default '', version text default '1.0',
 changelog text default '', cover text default '', images jsonb default '[]',
 file_key text, file_name text, file_size bigint default 0,
 category text not null default 'Ostalo',
 downloads int default 0, created_at timestamptz default now());
create table if not exists blacklist(
 discord_id text primary key, reason text default '', created_at timestamptz default now());
create table if not exists settings(key text primary key, value jsonb);
alter table scripts enable row level security;
alter table blacklist enable row level security;
alter table settings enable row level security;

-- Ako tabela scripts vec postoji, dodaj kategoriju bez brisanja postojecih podataka.
alter table scripts add column if not exists category text not null default 'Ostalo';
