create or replace function public.claim_agent1_handoff(p_lead_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead public.leads%rowtype;
  v_status text;
begin
  update public.leads
  set
    agent_state = jsonb_set(
      coalesce(agent_state, '{}'::jsonb),
      '{handoff}',
      coalesce(agent_state->'handoff', '{}'::jsonb) || jsonb_build_object(
        'agent_1_status', 'processing',
        'agent_1_started_at', now(),
        'agent_1_completed_at', null,
        'agent_1_failed_at', null,
        'agent_1_failure', null
      ),
      true
    ),
    updated_at = now()
  where id = p_lead_id
    and coalesce(agent_state #>> '{handoff,agent_1_status}', '') not in ('processing', 'completed')
  returning * into v_lead;

  if found then
    return jsonb_build_object(
      'claimed', true,
      'reason', 'agent_1_claimed',
      'lead', to_jsonb(v_lead)
    );
  end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'lead_not_found');
  end if;

  v_status := coalesce(v_lead.agent_state #>> '{handoff,agent_1_status}', '');
  return jsonb_build_object(
    'claimed', false,
    'reason',
      case
        when v_status = 'processing' then 'agent_1_already_processing'
        when v_status = 'completed' then 'agent_1_already_completed'
        else 'agent_1_handoff_not_claimed'
      end,
    'lead', to_jsonb(v_lead)
  );
end;
$$;

create or replace function public.complete_agent1_handoff(p_lead_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead public.leads%rowtype;
begin
  update public.leads
  set
    agent_state = jsonb_set(
      coalesce(agent_state, '{}'::jsonb),
      '{handoff}',
      coalesce(agent_state->'handoff', '{}'::jsonb) || jsonb_build_object(
        'agent_1_status', 'completed',
        'agent_1_completed_at', now(),
        'agent_1_failure', null
      ),
      true
    ),
    updated_at = now()
  where id = p_lead_id
  returning * into v_lead;

  if not found then
    return jsonb_build_object('updated', false, 'reason', 'lead_not_found');
  end if;

  return jsonb_build_object('updated', true, 'lead', to_jsonb(v_lead));
end;
$$;

create or replace function public.fail_agent1_handoff(p_lead_id text, p_error text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead public.leads%rowtype;
begin
  update public.leads
  set
    agent_state = jsonb_set(
      coalesce(agent_state, '{}'::jsonb),
      '{handoff}',
      coalesce(agent_state->'handoff', '{}'::jsonb) || jsonb_build_object(
        'agent_1_status', 'failed',
        'agent_1_failed_at', now(),
        'agent_1_failure', left(coalesce(p_error, ''), 1000)
      ),
      true
    ),
    updated_at = now()
  where id = p_lead_id
  returning * into v_lead;

  if not found then
    return jsonb_build_object('updated', false, 'reason', 'lead_not_found');
  end if;

  return jsonb_build_object('updated', true, 'lead', to_jsonb(v_lead));
end;
$$;
