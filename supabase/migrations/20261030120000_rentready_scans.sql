-- RentReady: automatic second-chance checks of property websites (OpenAI, quote-verified). Server-only tables.
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
