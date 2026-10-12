// Single source of truth for what each one-time upsell costs and which
// entitlement it grants. Prices are only ever read from here — never from
// the browser. (The $19.99/month listing membership is a Stripe recurring
// Price, configured in STRIPE_LISTING_PRICE_MONTHLY and validated in
// confirm-intent.js.)
const PRODUCTS = {
  gameplan: { amount: 2000, field: 'paidGameplan', label: 'RentReady Game Plan' },
  modern: { amount: 2000, field: 'paid27', label: 'RentReady Modern Apartment Matches & RentReady Guide', category: 'modern' },
  luxury: { amount: 2000, field: 'paid27', label: 'RentReady Luxury Apartment Matches & RentReady Guide', category: 'luxury' },
  apartment_prep: { amount: 2000, field: 'paid47', legacyField: 'paid27', label: 'RentReady Apartment Approval Preparation Kit', category: 'apartment_prep' },
  creditkit: { amount: 9700, field: 'paid97', label: 'RentReady Credit Action Kit' },
};

const UPSELL_PRODUCTS = Object.keys(PRODUCTS);
const APARTMENT_CATEGORIES = ['modern', 'luxury', 'apartment_prep'];
const CURRENCY = 'usd';

function productDef(product) {
  return Object.prototype.hasOwnProperty.call(PRODUCTS, product) ? PRODUCTS[product] : null;
}

function categoriesOf(ent) {
  return Array.isArray(ent && ent.purchasedCategories) ? ent.purchasedCategories : [];
}

// Before Game Plan had its own flag, buying it set only `paid27` (no
// category), while every apartment purchase also adds a category. A paid27
// record with no apartment category is therefore a legacy Game Plan purchase.
function hasLegacyGameplan(ent) {
  return !!(ent && ent.paid27) && !categoriesOf(ent).some((c) => APARTMENT_CATEGORIES.includes(c));
}

function ownsProduct(ent, product) {
  if (!ent) return false;
  const categories = categoriesOf(ent);
  switch (product) {
    case 'gameplan':
      return !!ent.paidGameplan || hasLegacyGameplan(ent);
    case 'modern':
    case 'luxury':
      return !!ent.paid27 && categories.includes(product);
    case 'apartment_prep':
      return categories.includes('apartment_prep') || (!!ent.paid47 && !categories.length);
    case 'creditkit':
      return !!ent.paid97;
    default:
      return false;
  }
}

// The entitlement patch a verified, succeeded payment for `product` grants.
function grantPatch(product, current) {
  const def = productDef(product);
  if (!def) return null;
  const patch = { [def.field]: true };
  if (def.legacyField) patch[def.legacyField] = true;
  if (def.category) patch.addPurchasedCategory = def.category;
  // Adding the first apartment category to a legacy Game Plan record would
  // otherwise erase the only evidence that they own the Game Plan.
  if (def.category && hasLegacyGameplan(current) && !current.paidGameplan) patch.paidGameplan = true;
  return patch;
}

// Server-side check that a PaymentIntent really is a payment for `product`
// by `leadId`, at the configured price and currency.
function paymentIntentMatches(pi, product, leadId) {
  const def = productDef(product);
  if (!pi || !def || pi.object === 'setup_intent') return false;
  const metadata = pi.metadata || {};
  if (leadId && metadata.leadId !== leadId) return false;
  if (metadata.product !== product) return false;
  if (pi.amount !== def.amount) return false;
  if (String(pi.currency || '').toLowerCase() !== CURRENCY) return false;
  return true;
}

module.exports = {
  PRODUCTS,
  UPSELL_PRODUCTS,
  APARTMENT_CATEGORIES,
  CURRENCY,
  productDef,
  ownsProduct,
  grantPatch,
  hasLegacyGameplan,
  paymentIntentMatches,
};
