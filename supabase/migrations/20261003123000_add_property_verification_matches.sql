create table if not exists public.property_verifications (
  property_id text primary key,
  screening_status text not null default 'unverified'
    check (screening_status in ('verified_second_chance', 'flexible_screening', 'unverified', 'verification_pending', 'verification_error')),
  verification_source_url text,
  verification_source_domain text,
  verification_evidence text,
  verification_method text,
  verified_at timestamptz,
  verification_expires_at timestamptz,
  verification_confidence numeric,
  verification_version text,
  raw_verification jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_listing_matches (
  id bigserial primary key,
  lead_id text not null references public.leads(id) on delete cascade,
  property_id text not null,
  category text not null default 'questionnaire',
  matched_at timestamptz not null default now(),
  match_type text not null default 'google_places',
  rank_order integer not null default 0,
  preview_snapshot jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, category, property_id)
);

create index if not exists property_verifications_status_idx
  on public.property_verifications (screening_status);

create index if not exists property_verifications_expires_idx
  on public.property_verifications (verification_expires_at);

create index if not exists user_listing_matches_lead_category_idx
  on public.user_listing_matches (lead_id, category);

create index if not exists user_listing_matches_property_idx
  on public.user_listing_matches (property_id);

alter table public.property_verifications enable row level security;
alter table public.user_listing_matches enable row level security;

revoke all on public.property_verifications from anon, authenticated;
revoke all on public.user_listing_matches from anon, authenticated;
