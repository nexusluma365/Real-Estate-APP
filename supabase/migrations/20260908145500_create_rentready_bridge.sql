create table if not exists public.leads (
  id text primary key,
  email text,
  first_name text,
  last_name text,
  phone text,
  preferred_city text,
  rent_budget numeric,
  beds_needed text,
  move_timeline text,
  move_reason text,
  raw_answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.entitlements (
  lead_id text primary key references public.leads(id) on delete cascade,
  paid10 boolean not null default false,
  paid27 boolean not null default false,
  paid97 boolean not null default false,
  membership_status text not null default 'inactive',
  membership_plan text,
  purchased_category text,
  stripe_customer_id text,
  stripe_payment_intent_id text,
  default_payment_method_id text,
  raw_entitlement jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.apartment_results (
  id bigserial primary key,
  lead_id text not null references public.leads(id) on delete cascade,
  category text not null check (category in ('modern', 'luxury')),
  provider text,
  criteria_json jsonb not null default '{}'::jsonb,
  properties_json jsonb not null default '[]'::jsonb,
  message text,
  raw_result jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, category)
);

create index if not exists leads_email_idx on public.leads (email);
create index if not exists apartment_results_lead_category_idx on public.apartment_results (lead_id, category);

alter table public.leads enable row level security;
alter table public.entitlements enable row level security;
alter table public.apartment_results enable row level security;

revoke all on public.leads from anon, authenticated;
revoke all on public.entitlements from anon, authenticated;
revoke all on public.apartment_results from anon, authenticated;
