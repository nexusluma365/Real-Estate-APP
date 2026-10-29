-- RentReady 2.0: Premium membership, curated listings, member features. Server-only tables (RLS on, no anon access).
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
  rent_cents INTEGER,                        -- advertised monthly rent from the source
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
