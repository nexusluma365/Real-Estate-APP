alter table public.entitlements
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text not null default 'inactive',
  add column if not exists subscription_started_at timestamptz,
  add column if not exists subscription_current_period_end timestamptz,
  add column if not exists subscription_cancel_at_period_end boolean not null default false,
  add column if not exists listing_access_status text not null default 'inactive',
  add column if not exists listing_subscription_welcome_sent_at timestamptz;

create index if not exists entitlements_stripe_subscription_id_idx
  on public.entitlements (stripe_subscription_id);

create index if not exists entitlements_subscription_status_idx
  on public.entitlements (subscription_status);

create index if not exists entitlements_listing_access_status_idx
  on public.entitlements (listing_access_status);
