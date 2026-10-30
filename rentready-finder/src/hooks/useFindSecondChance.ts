import { useCallback } from 'react';
import { useFinder } from '../context/FinderContext';
import { useMember } from '../context/MemberContext';
import { track } from '../services/member';

/**
 * "Find Second-Chance Apartments": switches results to second-chance listings only. Members see them in full; for
 * everyone else the membership offer opens too — sign up there, or "Already a member? Sign in" with an active subscription.
 */
export function useFindSecondChance() {
  const { activateSecondChance } = useFinder();
  const { premium, loading, openOffer } = useMember();
  return useCallback((location: string) => {
    window.dispatchEvent(new Event('rr:skip-intro'));
    activateSecondChance();
    track('second_chance_click', { cta_location: location });
    if (!loading && !premium.active) {
      openOffer('See every verified second-chance apartment in full — name, address, contact details and the screening policy its source publishes.', `second_chance_${location}`);
    }
  }, [activateSecondChance, premium.active, loading, openOffer]);
}
