-- RentReady database schema (Turso / libSQL — SQLite). Apply once to a new database:
--   turso db shell <db-name> < schema.sql
CREATE TABLE IF NOT EXISTS leads (
  lead_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  email_consent INTEGER NOT NULL DEFAULT 0,  -- marketing consent (transactional mail is always allowed)
  consent_basis TEXT,                        -- 'checkbox' | 'notice'
  consent_text TEXT,                         -- exact wording shown at opt-in
  consent_at TEXT,
  unsubscribed_at TEXT,
  session_id TEXT,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT,
  gclid TEXT, landing_intent TEXT, landing_path TEXT,
  lead_source TEXT,                          -- start | checkout | checklist | exit
  product_interest TEXT,
  qual_stage TEXT, qual_concern TEXT, qual_help TEXT,   -- quiz answers (never sent to ad platforms)
  intent_tier TEXT,                          -- high | medium | early (commercial urgency only)
  recommended_product TEXT,
  stripe_customer_id TEXT,
  upsell_payment_method TEXT,      -- Stripe pm_… id only. Never card data.
  upsell_consent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS orders (
  payment_intent_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  product TEXT NOT NULL CHECK (product IN ('creditready','playbook','guide','upgrade')),
  amount_cents INTEGER NOT NULL,
  lead_id TEXT,
  refunded_cents INTEGER NOT NULL DEFAULT 0,
  refunded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entitlements (
  customer_id TEXT NOT NULL,
  product TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (customer_id, product)
);
CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lifecycle_events (lead_id TEXT NOT NULL, event TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '', data TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assessments (customer_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  event TEXT NOT NULL, session_id TEXT, lead_id TEXT, product TEXT, value REAL, cta_location TEXT, intent_tier TEXT,
  utm_source TEXT, utm_campaign TEXT, landing_intent TEXT, page_path TEXT, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifecycle_lead ON lifecycle_events (lead_id, event);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lifecycle_once ON lifecycle_events (lead_id, event, ref);
CREATE INDEX IF NOT EXISTS idx_lifecycle_event_at ON lifecycle_events (event, at);
CREATE INDEX IF NOT EXISTS idx_orders_lead ON orders (lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_event_at ON events (event, at);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at);
CREATE TABLE IF NOT EXISTS access_tokens (token_hash TEXT PRIMARY KEY, lead_id TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);
