-- Draw Together: run this once in your Supabase project (SQL Editor → New query → Run).
-- Boards are public to anyone with the link, like a shared doc link.

create table if not exists public.ops (
  id text primary key,
  room text not null check (room ~ '^[a-z]+-[a-z]+-[0-9]{2}$'),
  t bigint not null,
  op jsonb not null check (octet_length(op::text) < 200000),
  created_at timestamptz not null default now()
);

create index if not exists ops_room_t on public.ops (room, t);

alter table public.ops enable row level security;

-- Anyone with the link can read a board and add to it. Nobody can edit or delete history,
-- which is what keeps every device's picture identical (erases and clears are new rows, not deletions).
drop policy if exists "read boards" on public.ops;
create policy "read boards" on public.ops for select to anon, authenticated using (true);

drop policy if exists "add to boards" on public.ops;
create policy "add to boards" on public.ops for insert to anon, authenticated with check (true);
