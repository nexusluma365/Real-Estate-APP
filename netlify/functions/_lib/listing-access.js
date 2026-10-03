const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

function normalizeSubscriptionStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function hasActiveListingAccess(entitlements) {
  const status = normalizeSubscriptionStatus(
    entitlements && (entitlements.listingSubscriptionStatus || entitlements.subscriptionStatus)
  );
  return ACTIVE_SUBSCRIPTION_STATUSES.has(status);
}

function listingAccessStatus(entitlements) {
  return hasActiveListingAccess(entitlements) ? 'active' : 'inactive';
}

function subscriptionStatusPatch(subscription, extra = {}) {
  const status = normalizeSubscriptionStatus(subscription && subscription.status);
  const currentPeriodStart = subscription && subscription.current_period_start
    ? new Date(subscription.current_period_start * 1000).toISOString()
    : null;
  const currentPeriodEnd = subscription && subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;
  return {
    listingSubscriptionId: subscription && subscription.id ? subscription.id : null,
    listingSubscriptionStatus: status || 'inactive',
    listingAccessStatus: ACTIVE_SUBSCRIPTION_STATUSES.has(status) ? 'active' : 'inactive',
    listingSubscriptionStartedAt: currentPeriodStart,
    listingSubscriptionCurrentPeriodEnd: currentPeriodEnd,
    listingSubscriptionCancelAtPeriodEnd: !!(subscription && subscription.cancel_at_period_end),
    ...extra,
  };
}

module.exports = {
  ACTIVE_SUBSCRIPTION_STATUSES,
  hasActiveListingAccess,
  listingAccessStatus,
  normalizeSubscriptionStatus,
  subscriptionStatusPatch,
};
