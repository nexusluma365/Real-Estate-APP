const VALID_STATUSES = new Set(['collecting', 'sales-ready']);

function classifyIntent(answers = {}) {
  const urgent = ['asap', '1_month'].includes(answers.move_timeline);
  const credit = String(answers.credit_score || '');
  const income = Number(answers.annual_income) || 0;
  const rent = Number(answers.rent_budget) || 0;
  const lowCredit = ['below_580', '580_619', '620_659'].includes(credit);
  const incomeTight = income && rent ? income / 12 < rent * 3 : false;
  if (urgent && lowCredit) return 'urgent_credit_support';
  if (urgent) return 'urgent_move';
  if (lowCredit) return 'credit_support';
  if (incomeTight) return 'income_fit_review';
  return 'general_renter';
}

function isSalesReady(answers = {}) {
  return !!(
    answers.first_name &&
    answers.last_name &&
    answers.email &&
    answers.phone &&
    answers.contact_method &&
    answers.preferred_city &&
    answers.move_timeline &&
    answers.annual_income &&
    answers.rent_budget &&
    answers.credit_score &&
    answers.beds_needed
  );
}

function normalizeAgentActivity(activity) {
  if (!Array.isArray(activity)) return [];
  return activity.slice(-80).map((event) => ({
    type: String(event && event.type ? event.type : 'agent_event').slice(0, 80),
    at: String(event && event.at ? event.at : new Date().toISOString()).slice(0, 40),
    step: String(event && event.step ? event.step : '').slice(0, 80),
    status: String(event && event.status ? event.status : '').slice(0, 40),
    intent: String(event && event.intent ? event.intent : '').slice(0, 80),
  }));
}

function normalizeAgentLead(answers = {}) {
  const intent = String(answers.agent_intent || classifyIntent(answers)).replace(/[^\w-]/g, '_').slice(0, 80) || 'general_renter';
  const statusCandidate = String(answers.agent_status || '').trim();
  const status = VALID_STATUSES.has(statusCandidate)
    ? statusCandidate
    : isSalesReady(answers)
    ? 'sales-ready'
    : 'collecting';
  const activity = normalizeAgentActivity(answers.agent_activity);
  const state = answers.agent_state && typeof answers.agent_state === 'object' ? answers.agent_state : {};
  return {
    agent_status: status,
    agent_intent: intent,
    agent_state: {
      agent: 'agent-number-one',
      version: String((state && state.version) || '1.0'),
      status,
      intent,
      current_step: String((state && state.current_step) || (status === 'sales-ready' ? 'handoff' : 'collecting')),
      handoff: {
        ...((state && state.handoff && typeof state.handoff === 'object') ? state.handoff : {}),
        target: 'sales-agent',
        status,
        ready: status === 'sales-ready',
      },
    },
    agent_activity: activity,
  };
}

function buildAgentHandoff(lead = {}) {
  const agent = normalizeAgentLead(lead);
  return {
    lead_id: lead.lead_id || lead.leadId || '',
    email: lead.email || '',
    phone: lead.phone || '',
    first_name: lead.first_name || '',
    last_name: lead.last_name || '',
    preferred_city: lead.preferred_city || '',
    move_timeline: lead.move_timeline || '',
    rent_budget: lead.rent_budget || '',
    beds_needed: lead.beds_needed || '',
    agent_status: agent.agent_status,
    agent_intent: agent.agent_intent,
    agent_state: agent.agent_state,
    agent_activity: agent.agent_activity,
    handoff_created_at: new Date().toISOString(),
  };
}

module.exports = {
  classifyIntent,
  isSalesReady,
  normalizeAgentActivity,
  normalizeAgentLead,
  buildAgentHandoff,
};
