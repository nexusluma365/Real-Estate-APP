-- RentReady digital-only fulfilment (2026-11): delivery log, reusable package links, order fulfilment type, affiliate attribution.
CREATE TABLE IF NOT EXISTS rr_deliveries (
  order_id TEXT PRIMARY KEY,                 -- Stripe PaymentIntent id (rr_orders.payment_intent_id)
  lead_id TEXT NOT NULL,
  product TEXT NOT NULL,
  status TEXT NOT NULL,                      -- pending | sent | failed | gave_up | skipped
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS rr_idx_deliveries_status ON rr_deliveries (status, updated_at);
ALTER TABLE rr_access_tokens ADD COLUMN IF NOT EXISTS reusable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rr_orders ADD COLUMN IF NOT EXISTS fulfillment TEXT;
ALTER TABLE rr_orders ADD COLUMN IF NOT EXISTS affiliate TEXT;
ALTER TABLE rr_leads ADD COLUMN IF NOT EXISTS affiliate TEXT;
CREATE INDEX IF NOT EXISTS rr_idx_orders_affiliate ON rr_orders (affiliate, created_at);
ALTER TABLE rr_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE rr_deliveries FROM anon, authenticated;
