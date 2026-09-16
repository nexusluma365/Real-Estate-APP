alter table public.leads
  add column if not exists manychat_contact_id text;

alter table public.entitlements
  add column if not exists manychat_contact_id text;

alter table public.waiting_list
  add column if not exists manychat_contact_id text;

create index if not exists leads_manychat_contact_id_idx
  on public.leads (manychat_contact_id);

create index if not exists entitlements_manychat_contact_id_idx
  on public.entitlements (manychat_contact_id);

create index if not exists waiting_list_manychat_contact_id_idx
  on public.waiting_list (manychat_contact_id);
