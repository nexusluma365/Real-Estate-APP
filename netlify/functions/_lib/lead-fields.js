// Fields that only the server (after Stripe confirms something) may set.
// They live in the entitlements table, never in questionnaire answers, but
// they are stripped from browser-submitted answers anyway so nothing
// downstream can ever mistake a client-supplied value for the real thing.
const SERVER_OWNED_FIELDS = [
  'paid10', 'paid27', 'paid47', 'paid97', 'paidGameplan',
  'membershipStatus', 'membership_status', 'membershipPlan', 'membership_plan',
  'purchasedCategory', 'purchased_category', 'purchasedCategories', 'purchased_categories',
  'productPaymentIntents',
  'stripeCustomerId', 'stripe_customer_id',
  'stripePaymentIntentId', 'stripe_payment_intent_id',
  'defaultPaymentMethodId', 'default_payment_method_id',
  'stripeSubscriptionId', 'stripe_subscription_id',
  'listingSubscriptionId', 'listingSubscriptionStatus', 'listingAccessStatus', 'listing_access_status',
  'listingSubscriptionStartedAt', 'listingSubscriptionCurrentPeriodEnd', 'listingSubscriptionCancelAtPeriodEnd',
  'listingSubscriptionWelcomeSentAt', 'listingSetupIntentId', 'cardSetupIntentId',
  'subscription_status', 'subscriptionStatus',
  'entitlements', 'session', 'rr_session',
];

function sanitizeLeadAnswers(answers) {
  if (!answers || typeof answers !== 'object') return {};
  const clean = { ...answers };
  for (const field of SERVER_OWNED_FIELDS) delete clean[field];
  return clean;
}

module.exports = { SERVER_OWNED_FIELDS, sanitizeLeadAnswers };
