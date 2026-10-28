import { fail, getSession, json, notConfigured, setSession, stripe, type Ctx } from '../../_lib';

/** POST /api/payments/customer — createCustomer(). Reuses the Stripe Customer for this lead. */
export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.STRIPE_SECRET_KEY || !env.SESSION_SECRET || !env.DB) return notConfigured('Payments');
  const s = await getSession(request, env);
  if (!s) return fail(401, 'Your session expired. Start again from your plan.', 'no_session');
  const lead = await env.DB.prepare('SELECT email, first_name, stripe_customer_id FROM rr_leads WHERE lead_id = ?').bind(s.lead_id).first<{ email: string; first_name: string; stripe_customer_id: string | null }>();
  if (!lead) return fail(404, 'We couldn’t find your plan details.', 'no_lead');
  let customer_id = lead.stripe_customer_id;
  if (!customer_id) {
    // INTEGRATE: if Essential Credit already creates customers by email, reuse that lookup here.
    const c = await stripe<{ id: string }>(env, 'POST', 'customers', { email: lead.email, name: lead.first_name, 'metadata[lead_id]': s.lead_id }, `cus_${s.lead_id}`);
    customer_id = c.id;
    await env.DB.prepare('UPDATE rr_leads SET stripe_customer_id = ? WHERE lead_id = ?').bind(customer_id, s.lead_id).run();
  }
  return json({ customer_id }, 200, { 'Set-Cookie': await setSession(env, { lead_id: s.lead_id, customer_id }) });
};
