create table if not exists public.waiting_list (
  id bigserial primary key,
  lead_id text,
  category text,
  selected_city text,
  reason text,
  raw_entry jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists waiting_list_lead_category_idx on public.waiting_list (lead_id, category);

alter table public.waiting_list enable row level security;

revoke all on public.waiting_list from anon, authenticated;
