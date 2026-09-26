create table if not exists public.property_image_cache (
  id text primary key,
  property_id text,
  property_name text,
  property_address text,
  official_website text,
  image_url text,
  source_page_url text,
  source_domain text,
  source_type text,
  verification_status text not null default 'unverified',
  verification_reason text,
  raw_cache jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_verified_at timestamptz
);

create index if not exists property_image_cache_property_id_idx
  on public.property_image_cache (property_id);

create index if not exists property_image_cache_status_idx
  on public.property_image_cache (verification_status);

alter table public.property_image_cache enable row level security;

revoke all on public.property_image_cache from anon, authenticated;
