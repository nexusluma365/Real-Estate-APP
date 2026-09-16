alter table public.leads
  add column if not exists agent_status text,
  add column if not exists agent_intent text,
  add column if not exists agent_state jsonb not null default '{}'::jsonb,
  add column if not exists agent_activity jsonb not null default '[]'::jsonb;

create index if not exists leads_agent_status_idx
  on public.leads (agent_status);

create index if not exists leads_agent_intent_idx
  on public.leads (agent_intent);
