/** Second-chance verification levels. "verified" requires stored evidence — never inferred. */
export type PolicyStatus = 'verified' | 'flexible' | 'unconfirmed';

export type PolicyCategory =
  | 'credit'
  | 'collections'
  | 'eviction'
  | 'rental_history'
  | 'prior_denial'
  | 'other';

export type VerificationMethod = 'published_policy' | 'direct_confirmation' | 'third_party_listing' | 'ai_extraction_reviewed';

/** One evidence-backed claim. Structure defined now; storage arrives in Phase D. */
export interface PolicyClaim {
  id: string;
  propertyId: string; // Google Place ID (stable identifier; allowed to store)
  category: PolicyCategory;
  claim: string;
  evidenceSource: string;
  sourceUrl: string | null;
  dateChecked: string; // ISO
  method: VerificationMethod;
  status: PolicyStatus;
  conditions: string | null;
  lastUpdated: string; // ISO
  expiresAt: string; // ISO — claims must be rechecked after this
}

export const POLICY_LEVELS: Record<PolicyStatus, { label: string; short: string; description: string }> = {
  verified: {
    label: 'Verified Policy',
    short: 'Verified policy',
    description:
      'A published property-management policy or a directly confirmed statement supports the specific screening claim.',
  },
  flexible: {
    label: 'Potentially Flexible',
    short: 'Potentially flexible',
    description: 'There is relevant evidence suggesting flexibility, but acceptance terms are not fully confirmed.',
  },
  unconfirmed: {
    label: 'Policy Not Confirmed',
    short: 'Rental policy not confirmed',
    description: 'No reliable information is available yet about second-chance eligibility.',
  },
};
