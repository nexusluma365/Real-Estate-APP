import { fail, type Ctx } from '../../_lib';

/**
 * POST /api/upsell/charge — retired. The $100 Property Manager Playbook is no longer sold (digital-only switch,
 * 2026-11). Kept as an endpoint so old pages or cached scripts get a clear answer and nobody's card is ever charged.
 * Customers who already bought the Playbook keep it (see rr_entitlements).
 */
export const onRequestPost = async (_ctx: Ctx) => fail(410, 'This offer is no longer available. You have not been charged.', 'retired');
