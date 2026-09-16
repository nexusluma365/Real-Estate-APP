const assert = require('assert');

const {
  classifyIntent,
  normalizeAgentLead,
  buildAgentHandoff,
} = require('../netlify/functions/_lib/agent-number-one');

const answers = {
  lead_id: 'lead_agent_123',
  first_name: 'Rae',
  last_name: 'Ready',
  email: 'rae@example.com',
  phone: '7045550100',
  contact_method: 'sms',
  preferred_city: 'Charlotte, NC',
  move_timeline: 'asap',
  annual_income: 72000,
  rent_budget: 1800,
  credit_score: '700_739',
  beds_needed: '1',
  agent_activity: [
    { type: 'question_presented', at: '2026-09-16T10:00:00.000Z', step: 'email', extra: '<ignored>' },
    { type: 'handoff_ready', at: '2026-09-16T10:02:00.000Z', step: 'review' },
  ],
};

assert.equal(classifyIntent({ ...answers, credit_score: '580_619' }), 'urgent_credit_support');
assert.equal(classifyIntent(answers), 'urgent_move');

const agent = normalizeAgentLead(answers);
assert.equal(agent.agent_status, 'sales-ready');
assert.equal(agent.agent_intent, 'urgent_move');
assert.equal(agent.agent_state.handoff.target, 'sales-agent');
assert.equal(agent.agent_state.handoff.ready, true);
assert.equal(agent.agent_activity.length, 2);
assert.equal(agent.agent_activity[0].extra, undefined);

const handoff = buildAgentHandoff({ ...answers, ...agent });
assert.equal(handoff.lead_id, 'lead_agent_123');
assert.equal(handoff.agent_status, 'sales-ready');
assert.equal(handoff.agent_intent, 'urgent_move');
assert.equal(handoff.agent_state.handoff.ready, true);

console.log('agent number one test passed');
