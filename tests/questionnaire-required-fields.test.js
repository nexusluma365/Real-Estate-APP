const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/src/pages/Questionnaire/page.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app/src/pages/Questionnaire/page.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'app/src/pages/Questionnaire/script-0.js'), 'utf8');

assert.ok(html.includes('data-agent-number-one'), 'questionnaire should mount Aria flow');
assert.ok(html.includes("Let's Find the Right Rental Path for You"), 'intro should use customer-ready headline');
assert.ok(html.includes("I'll ask you a few quick questions about what you're looking for and where you currently stand."), 'intro should use customer-ready supporting copy');
assert.ok(html.includes('aria-robot'), 'decorative ARIA robot should be present');
assert.ok(html.includes('No Approval Promise'), 'agent must avoid approval positioning');
assert.ok(html.includes('No Guarantee'), 'agent must avoid guarantee positioning');
assert.ok(html.includes('agentConversation'), 'chat transcript mount should exist');
assert.ok(html.includes('agentResponseMount'), 'one-question response mount should exist');

[
  'Agent Number One',
  'agent_status',
  'sales-ready',
  'intent classification',
  'Qualification Agent',
  'AI workflow',
  'N8N',
].forEach((text) => {
  assert.ok(!html.includes(text), `${text} should not be visible in initial customer HTML`);
});

[
  'first_name',
  'last_name',
  'email',
  'phone',
  'contact_method',
  'preferred_city',
  'move_timeline',
  'move_reason',
  'annual_income',
  'rent_budget',
  'credit_score',
  'beds_needed',
].forEach((field) => {
  assert.ok(js.includes(`field: '${field}'`), `${field} should be collected by Aria`);
});

[
  'agent_status',
  'agent_intent',
  'agent_state',
  'agent_activity',
  'sales-ready',
  'intent_classified',
  'handoff_ready',
  'lead_submitted',
  'rrn_answers_v1',
].forEach((text) => {
  assert.ok(js.includes(text), `${text} should be represented in the agent flow`);
});

assert.match(js, /function classifyIntent\(answers\)/);
assert.match(js, /function salesReady\(answers\)/);
assert.match(js, /window\.rrnAttachManyChatContactId/);
assert.match(js, /role === 'agent' \? 'Aria' : 'You'/);
assert.match(js, /started: false/);
assert.match(js, /agent-started/);
assert.match(css, /\.agent-conversation/);
assert.match(css, /\.agent-conversation \{[\s\S]*display: none;/);
assert.match(css, /\.agent-started \.agent-conversation \{[\s\S]*display: block;/);
assert.match(css, /\.agent-started \.agent-intro \{ display: none; \}/);
assert.match(css, /\.aria-robot/);
assert.match(css, /@keyframes ariaLook/);
assert.match(css, /@keyframes ariaBlink/);
assert.match(css, /@keyframes agentFadeIn/);
assert.match(css, /\.agent-message-user/);
assert.match(css, /\.agent-option\.selected/);
assert.match(css, /\.agent-money-field/);
assert.match(css, /@media \(max-width: 620px\) \{[\s\S]*\.agent-options \{ grid-template-columns: 1fr; \}/);

console.log('questionnaire agent flow test passed');
