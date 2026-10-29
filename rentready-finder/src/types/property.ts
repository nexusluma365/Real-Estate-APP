import type { PolicyStatus } from './policy';

/** A property normalized from Google Places (Phase B/C). Every optional field may be genuinely missing. */
export interface Property {
  placeId: string;
  name: string;
  formattedAddress: string;
  city: string | null;
  neighborhood: string | null;
  location: { lat: number; lng: number };
  phone: string | null;
  website: string | null;
  googleMapsUri: string | null;
  primaryType: string | null;
  photos: PropertyPhoto[];
  /** Factual summary built only from retrieved data. Null until enriched. */
  summary: string | null;
  policyStatus: PolicyStatus;
  /** Pricing is only shown when an authorized listing provider supplies it. */
  pricing: { text: string; source: string; retrievedAt: string } | null;
}

export interface PropertyPhoto {
  /** Places API (New) photo resource name, e.g. places/{id}/photos/{ref}. Fetched through our server proxy. */
  name: string;
  widthPx: number;
  heightPx: number;
  attributions: { displayName: string; uri: string }[];
}

export interface SearchFilters {
  minRent: number | null;
  maxRent: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  propertyType: 'any' | 'apartment' | 'townhome' | 'condo';
  secondChance: 'any' | 'verified' | 'flexible';
  radiusMiles: number;
}

export const DEFAULT_FILTERS: SearchFilters = {
  minRent: null,
  maxRent: null,
  bedrooms: null,
  bathrooms: null,
  propertyType: 'any',
  secondChance: 'any',
  radiusMiles: 10,
};

export interface LocationSuggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string;
}
