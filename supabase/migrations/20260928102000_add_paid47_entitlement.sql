alter table public.entitlements
  add column if not exists paid47 boolean not null default false;
