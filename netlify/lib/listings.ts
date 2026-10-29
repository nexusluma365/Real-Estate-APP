import type { Env } from './_lib';

/**
 * RentReady listings: curated, sourced records (never Google Places guesses). Classifications:
 * standard · verified_second_chance (needs a source URL + verification date) · unknown (screening criteria unknown)
 * · unavailable (kept for links, never shown in search). Premium-only fields are removed HERE, on the server.
 */
export const CLASSIFICATIONS = ['standard', 'verified_second_chance', 'unknown', 'unavailable'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export interface ListingRow {
  listing_id: string; classification: Classification; name: string; address: string | null; city: string; state: string;
  rent_cents: number | null; beds: number | null; baths: number | null; description: string | null; phone: string | null;
  website: string | null; photo_url: string | null; screening_note: string | null; source_name: string; source_url: string;
  verified_at: string | null; created_at: string; updated_at: string;
}

export type PublicListing =
  | ({ locked: false } & Omit<ListingRow, 'created_at' | 'updated_at'>)
  | { locked: true; listing_id: string; classification: 'verified_second_chance'; city: string; state: string; rent_cents: number | null; beds: number | null; baths: number | null; verified_at: string | null };

/** Second-chance details are a Premium feature; everything else is public. */
export function present(row: ListingRow, premium: boolean): PublicListing {
  if (row.classification === 'verified_second_chance' && !premium) {
    const { listing_id, city, state, rent_cents, beds, baths, verified_at } = row;
    return { locked: true, listing_id, classification: 'verified_second_chance', city, state, rent_cents, beds, baths, verified_at };
  }
  const { created_at: _c, updated_at: _u, ...rest } = row;
  return { locked: false, ...rest };
}

const ORDER: Record<Classification, number> = { verified_second_chance: 0, standard: 1, unknown: 2, unavailable: 3 };

export async function listingsIn(env: Env, city: string, state: string): Promise<ListingRow[]> {
  const rows = (await env.DB!.prepare("SELECT * FROM rr_listings WHERE LOWER(city) = LOWER(?) AND UPPER(state) = UPPER(?) AND classification <> 'unavailable' LIMIT 200")
    .bind(city.trim(), state.trim()).all<ListingRow>()).results;
  return rows.sort((a, b) => ORDER[a.classification] - ORDER[b.classification] || (a.rent_cents ?? 1e9) - (b.rent_cents ?? 1e9));
}

/** "Charlotte, NC, USA" / "Charlotte NC" → { city, state } (US two-letter state), or null. */
export function parsePlace(raw: string): { city: string; state: string } | null {
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2 && /^[A-Za-z]{2}\b/.test(parts[1])) return { city: parts[0], state: parts[1].slice(0, 2).toUpperCase() };
  const m = /^(.+?)\s+([A-Za-z]{2})$/.exec(raw.trim());
  return m ? { city: m[1].replace(/,$/, ''), state: m[2].toUpperCase() } : null;
}
