import { fail, type Ctx } from '../../_lib';

/**
 * POST /api/payments/save-method — retired. It saved a card for the one-click Playbook upsell, which is no longer
 * sold (digital-only switch, 2026-11). Nothing is saved for later charges any more.
 */
export const onRequestPost = async (_ctx: Ctx) => fail(410, 'This feature is no longer available.', 'retired');
