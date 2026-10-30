-- RentReady-owned tables are prefixed rr_ to keep them isolated from the existing
-- Real-Estate-APP tables in the shared Supabase project.
-- Apply once using the Supabase SQL Editor. Also used by the local SQLite test harness.
CREATE TABLE IF NOT EXISTS rr_leads (
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
CREATE TABLE IF NOT EXISTS rr_orders (
  payment_intent_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  product TEXT NOT NULL CHECK (product IN ('creditready','playbook','guide','upgrade')),
  amount_cents INTEGER NOT NULL,
  lead_id TEXT,
  refunded_cents INTEGER NOT NULL DEFAULT 0,
  refunded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rr_entitlements (
  customer_id TEXT NOT NULL,
  product TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (customer_id, product)
);
CREATE TABLE IF NOT EXISTS rr_webhook_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rr_lifecycle_events (lead_id TEXT NOT NULL, event TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '', data TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rr_assessments (customer_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rr_events (
  event TEXT NOT NULL, session_id TEXT, lead_id TEXT, product TEXT, value REAL, cta_location TEXT, intent_tier TEXT,
  utm_source TEXT, utm_campaign TEXT, landing_intent TEXT, page_path TEXT, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rr_idx_lifecycle_lead ON rr_lifecycle_events (lead_id, event);
CREATE UNIQUE INDEX IF NOT EXISTS rr_uq_lifecycle_once ON rr_lifecycle_events (lead_id, event, ref);
CREATE INDEX IF NOT EXISTS rr_idx_lifecycle_event_at ON rr_lifecycle_events (event, at);
CREATE INDEX IF NOT EXISTS rr_idx_orders_lead ON rr_orders (lead_id, created_at);
CREATE INDEX IF NOT EXISTS rr_idx_events_event_at ON rr_events (event, at);
CREATE INDEX IF NOT EXISTS rr_idx_leads_created ON rr_leads (created_at);
CREATE TABLE IF NOT EXISTS rr_access_tokens (token_hash TEXT PRIMARY KEY, lead_id TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);

-- These tables are accessed only by the server-side Netlify PostgreSQL connection.
-- Do not expose personal, payment, or assessment data through Supabase's browser API.
ALTER TABLE rr_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_access_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE rr_leads FROM anon, authenticated;
REVOKE ALL ON TABLE rr_orders FROM anon, authenticated;
REVOKE ALL ON TABLE rr_entitlements FROM anon, authenticated;
REVOKE ALL ON TABLE rr_webhook_events FROM anon, authenticated;
REVOKE ALL ON TABLE rr_lifecycle_events FROM anon, authenticated;
REVOKE ALL ON TABLE rr_assessments FROM anon, authenticated;
REVOKE ALL ON TABLE rr_events FROM anon, authenticated;
REVOKE ALL ON TABLE rr_access_tokens FROM anon, authenticated;

-- RentReady 2.0 (supabase/migrations/20261029120000_rentready_premium.sql)
CREATE TABLE IF NOT EXISTS rr_subscriptions (
  subscription_id TEXT PRIMARY KEY,          -- Stripe sub_…
  customer_id TEXT NOT NULL,                 -- Stripe cus_…
  lead_id TEXT,
  status TEXT NOT NULL,                      -- Stripe status: active | trialing | past_due | unpaid | canceled | incomplete | incomplete_expired
  current_period_end TEXT,                   -- ISO; access runs to here (plus the grace period when past_due)
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  canceled_at TEXT,
  intro_used INTEGER NOT NULL DEFAULT 1,     -- the $5 first month was applied
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rr_idx_subs_customer ON rr_subscriptions (customer_id);
CREATE TABLE IF NOT EXISTS rr_listings (
  listing_id TEXT PRIMARY KEY,
  classification TEXT NOT NULL CHECK (classification IN ('standard','verified_second_chance','unknown','unavailable')),
  name TEXT NOT NULL,
  address TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  rent_cents INTEGER,                        -- advertised monthly rent from the source (lowest, when a range)
  rent_max_cents INTEGER,                    -- highest advertised rent, when the source gives a range
  beds REAL, baths REAL,
  description TEXT, phone TEXT, website TEXT, photo_url TEXT,
  screening_note TEXT,                       -- what the source says about screening (premium detail)
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  verified_at TEXT,                          -- required for verified_second_chance
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rr_idx_listings_city ON rr_listings (state, city);
CREATE TABLE IF NOT EXISTS rr_saved_listings (customer_id TEXT NOT NULL, ref TEXT NOT NULL, label TEXT NOT NULL, detail TEXT, saved_at TEXT NOT NULL, PRIMARY KEY (customer_id, ref));
CREATE TABLE IF NOT EXISTS rr_recent_views (customer_id TEXT NOT NULL, ref TEXT NOT NULL, label TEXT NOT NULL, detail TEXT, viewed_at TEXT NOT NULL, PRIMARY KEY (customer_id, ref));
CREATE TABLE IF NOT EXISTS rr_saved_searches (
  search_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, label TEXT NOT NULL, city TEXT NOT NULL, state TEXT NOT NULL,
  alerts INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rr_idx_searches_customer ON rr_saved_searches (customer_id);
CREATE TABLE IF NOT EXISTS rr_premium_invoices (
  invoice_id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL, customer_id TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  billing_reason TEXT, status TEXT NOT NULL, refunded_cents INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rr_alerts_sent (search_id TEXT NOT NULL, listing_id TEXT NOT NULL, sent_at TEXT NOT NULL, PRIMARY KEY (search_id, listing_id));

ALTER TABLE rr_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_saved_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_recent_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_alerts_sent ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_premium_invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE rr_subscriptions FROM anon, authenticated;
REVOKE ALL ON TABLE rr_listings FROM anon, authenticated;
REVOKE ALL ON TABLE rr_saved_listings FROM anon, authenticated;
REVOKE ALL ON TABLE rr_recent_views FROM anon, authenticated;
REVOKE ALL ON TABLE rr_saved_searches FROM anon, authenticated;
REVOKE ALL ON TABLE rr_alerts_sent FROM anon, authenticated;
REVOKE ALL ON TABLE rr_premium_invoices FROM anon, authenticated;

-- (supabase/migrations/20261030120000_rentready_scans.sql)
CREATE TABLE IF NOT EXISTS rr_place_scans (
  place_id TEXT PRIMARY KEY,                 -- Google place id
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  name TEXT NOT NULL,
  website TEXT,
  result TEXT NOT NULL,                      -- second_chance | no | unclear | no_website | unreachable | error
  evidence_quote TEXT,                       -- exact sentence from the page (verified present before saving)
  evidence_url TEXT,
  rent_min_cents INTEGER,
  rent_max_cents INTEGER,
  model TEXT,
  scanned_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rr_idx_place_scans_area ON rr_place_scans (state, city);
CREATE TABLE IF NOT EXISTS rr_scan_queue (
  place_id TEXT PRIMARY KEY,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  payload TEXT NOT NULL,                     -- the Google place (name, address, phone, website, photo)
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  enqueued_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rr_area_scans (area_key TEXT PRIMARY KEY, requested_at TEXT NOT NULL, places INTEGER NOT NULL DEFAULT 0);

ALTER TABLE rr_place_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_scan_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_area_scans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE rr_place_scans FROM anon, authenticated;
REVOKE ALL ON TABLE rr_scan_queue FROM anon, authenticated;
REVOKE ALL ON TABLE rr_area_scans FROM anon, authenticated;
