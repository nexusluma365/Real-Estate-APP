import { notConfigured, type Ctx } from '../../_lib';

/**
 * POST /api/payments/attach — attachPaymentMethod().
 * Not needed with setup_future_usage (Stripe attaches on success). Implement only if the existing
 * Essential Credit flow uses SetupIntents: POST /v1/payment_methods/{pm}/attach { customer }.
 */
export const onRequestPost = async ({ env }: Ctx) => (env.STRIPE_SECRET_KEY ? new Response(JSON.stringify({ attached: true }), { headers: { 'Content-Type': 'application/json' } }) : notConfigured('Payments'));
