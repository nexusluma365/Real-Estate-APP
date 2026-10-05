
(function(){
  var ANSWERS_STORAGE_KEY = 'rrn_answers_v1';
  var FLOW_ACCESS_KEY = 'rrn_flow_access_v1';
  var ENTRY_INTENT_KEY = 'rrn_entry_intent_v1';
  var PRESCREEN_INTENT_KEY = 'rrn_prescreen_payment_intent_v1';
  var RESULTS_URL = '/after-payment-results/';
  var START_URL = '/index.html';
  var FALLBACK_STRIPE_PUBLISHABLE_KEY = 'pk_test_51UFFsZAYPiGDuG9e6Y8IS6i69lBTeKG9VLmMNUH6J0Ku6SrjzTOfqJZeEi2rrfri2Ive2zL4trt4fSXCWnLRVMSS00RNMFJPu4';
  var PAYMENT_DECLINED_MESSAGE = "Your payment didn't go through. Please check your card details and try again.";
  var PAY_BUTTON_LABEL = 'UNLOCK MY MATCHES';
  var VALID_ENTRY_INTENTS = ['bad_credit','eviction','broken_lease','denied_application','income_requirements','no_credit','approval_requirements','second_chance','general_renter'];
  var INTENT_MESSAGES = {
    bad_credit: 'Second-chance options may be included when available.',
    eviction: 'Second-chance options may be included when available.',
    broken_lease: 'Second-chance options may be included when available.',
    denied_application: 'Second-chance options may be included when available.',
    income_requirements: 'Second-chance options may be included when available.',
    no_credit: 'Second-chance options may be included when available.',
    approval_requirements: 'Second-chance options may be included when available.',
    second_chance: 'Second-chance options may be included when available.',
    general_renter: 'Second-chance options may be included when available.',
  };
  var stripe = null;
  var elements = null;
  var cardNumber = null;
  var cardExpiry = null;
  var cardCvc = null;
  var setupIntentId = '';
  var paymentClientSecret = '';

  function readAnswers(){
    try { return JSON.parse(sessionStorage.getItem(ANSWERS_STORAGE_KEY) || localStorage.getItem(ANSWERS_STORAGE_KEY) || '{}') || {}; }
    catch (_e) { return {}; }
  }

  function returnAccessToken(){
    try { return new URLSearchParams(window.location.search || '').get('token') || ''; }
    catch (_e) { return ''; }
  }

  function rememberAnswers(answers){
    try { sessionStorage.setItem(ANSWERS_STORAGE_KEY, JSON.stringify(answers)); } catch (_e) {}
    try { localStorage.setItem(ANSWERS_STORAGE_KEY, JSON.stringify(answers)); } catch (_e) {}
  }

  function rrTrack(eventName, detail){
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(Object.assign({ event: eventName }, detail || {}));
      window.dispatchEvent(new CustomEvent('rentready:event', { detail: Object.assign({ event: eventName }, detail || {}) }));
    } catch (_e) {}
  }

  // Google Ads conversion for the RentReady trial start. Paste the label from the
  // conversion action's event snippet (send_to: 'AW-18213168150/<label>').
  var GOOGLE_ADS_ID = 'AW-18213168150';
  var GOOGLE_ADS_PURCHASE_LABEL = '';

  function trackGooglePurchase(transactionId){
    try {
      if (typeof window.gtag !== 'function') return;
      var purchase = { value: 1, currency: 'USD', transaction_id: transactionId || '', transport_type: 'beacon' };
      window.gtag('event', 'purchase', Object.assign({ send_to: GOOGLE_ADS_ID }, purchase));
      if (GOOGLE_ADS_PURCHASE_LABEL) {
        window.gtag('event', 'conversion', Object.assign({ send_to: GOOGLE_ADS_ID + '/' + GOOGLE_ADS_PURCHASE_LABEL }, purchase));
      }
    } catch (_e) {}
  }

  function readEntryIntent(answers){
    if (answers && VALID_ENTRY_INTENTS.indexOf(answers.entry_intent) >= 0) return answers.entry_intent;
    try {
      var sessionValue = sessionStorage.getItem(ENTRY_INTENT_KEY);
      if (VALID_ENTRY_INTENTS.indexOf(sessionValue) >= 0) return sessionValue;
      var localValue = localStorage.getItem(ENTRY_INTENT_KEY);
      if (VALID_ENTRY_INTENTS.indexOf(localValue) >= 0) return localValue;
    } catch (_e) {}
    return 'general_renter';
  }

  function storeEntryIntent(value){
    if (VALID_ENTRY_INTENTS.indexOf(value) < 0) return;
    try { sessionStorage.setItem(ENTRY_INTENT_KEY, value); } catch (_e) {}
    try { localStorage.setItem(ENTRY_INTENT_KEY, value); } catch (_e) {}
  }

  function queryParam(name){
    try {
      if (typeof URLSearchParams !== 'undefined') {
        return new URLSearchParams(window.location.search || '').get(name) || '';
      }
      var search = String((window.location && window.location.search) || '').replace(/^\?/, '');
      var parts = search ? search.split('&') : [];
      for (var i = 0; i < parts.length; i += 1) {
        var pair = parts[i].split('=');
        if (decodeURIComponent(pair[0] || '') === name) return decodeURIComponent((pair[1] || '').replace(/\+/g, ' '));
      }
    } catch (_e) {}
    return '';
  }

  function marketingContext(answers){
    return {
      entry_intent: readEntryIntent(answers),
      landing_page: window.location.pathname || '',
      utm_source: queryParam('utm_source'),
      utm_medium: queryParam('utm_medium'),
      utm_campaign: queryParam('utm_campaign'),
      utm_term: queryParam('utm_term'),
      utm_content: queryParam('utm_content'),
    };
  }

  function hydrateIntentContext(answers){
    var entryIntent = readEntryIntent(answers);
    storeEntryIntent(entryIntent);
    var el = document.getElementById('checkoutIntentContext');
    if (el) el.textContent = INTENT_MESSAGES[entryIntent] || INTENT_MESSAGES.general_renter;
  }

  function label(value, map){
    var raw = String(value || '').replace(/_/g, ' ').trim();
    return map[value] || (raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Not provided');
  }

  function showError(message){
    var el = document.getElementById('paymentError');
    el.textContent = message || 'Could not start checkout.';
    el.classList.add('show');
  }

  function showSetupNote(message){
    var el = document.getElementById('setupNote');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
  }

  function deferNavigation(callback, delay){
    if (typeof setTimeout === 'function') setTimeout(callback, delay);
    else callback();
  }

  function bindElementState(element, id){
    var wrapper = document.getElementById(id);
    if (!wrapper) return;
    wrapper.addEventListener('click', function(){ element.focus(); });
    element.on('focus', function(){ wrapper.classList.add('is-focused'); });
    element.on('blur', function(){ wrapper.classList.remove('is-focused'); });
    element.on('change', function(event){
      wrapper.classList.toggle('is-invalid', !!event.error);
      if (event.error) showError(event.error.message);
      else document.getElementById('paymentError').classList.remove('show');
    });
  }

  async function fetchJson(url, options){
    var res = await fetch(url, options);
    var data = await res.json().catch(function(){ return {}; });
    if (!res.ok || !data || data.ok === false) throw new Error((data && data.error) || 'Request failed.');
    return data;
  }

  async function getStripePublishableKey(){
    try {
      var config = await fetchJson('/.netlify/functions/config');
      if (config && config.stripePublishableKey) return config.stripePublishableKey;
    } catch (err) {
      console.warn('Using fallback Stripe publishable key', err);
    }
    return FALLBACK_STRIPE_PUBLISHABLE_KEY;
  }

  async function createPrescreenIntent(answers){
    var trackedAnswers = window.rrnAttachManyChatContactId ? window.rrnAttachManyChatContactId(answers) : answers;
    var intent = await fetchJson('/.netlify/functions/create-payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: trackedAnswers.lead_id, email: trackedAnswers.email || '', answers: trackedAnswers }),
    });
    setupIntentId = intent.setupIntentId || intent.paymentIntentId || '';
    paymentClientSecret = intent.clientSecret;
    return intent;
  }

  function grantResultsAccess(){
    try {
      sessionStorage.setItem(FLOW_ACCESS_KEY, JSON.stringify({
        step: 'prescreen-results',
        status: 'confirmed',
        at: Date.now(),
      }));
    } catch (_e) {}
  }

  function rememberPrescreenPaymentIntent(intentId){
    if (!intentId) return;
    try { sessionStorage.setItem(PRESCREEN_INTENT_KEY, intentId); } catch (_e) {}
    try { localStorage.setItem(PRESCREEN_INTENT_KEY, intentId); } catch (_e) {}
  }

  function hydrateSummary(answers){
    document.getElementById('summaryCity').textContent = answers.preferred_city || 'Not provided';
    document.getElementById('summaryMove').textContent = label(answers.move_timeline, {
      // Values the current questionnaire saves:
      asap: 'ASAP',
      '1_month': 'Within 30 days',
      '3_months': '1-3 months',
      '6_months': '3-6 months',
      // Legacy values from earlier questionnaire versions:
      immediately: 'Immediately',
      under_30: 'Under 30 days',
      '30_60_days': '30-60 days',
      '60_plus': '60+ days',
      flexible: 'Flexible',
      one_to_three_months: 'in 1-3 months',
    });
  }

  // The headline only claims second-chance matches when the server verified
  // at least one property (screeningStatus "verified_second_chance").
  // Otherwise — including when results could not be loaded — it uses
  // neutral "apartment options" copy.
  var VERIFIED_COUNT_KEY = 'rrn_verified_second_chance_v1';
  var leadEl = document.getElementById('checkoutLead');
  var SECOND_CHANCE_LEAD = leadEl ? leadEl.textContent : '';

  var HEADLINE_FALLBACK_MS = 6000;
  var headlineShown = false;

  // The headline starts hidden (.headline-pending in the page markup) so the
  // static second-chance text never flashes before the real state is known.
  function revealHeadline(){
    headlineShown = true;
    var hero = document.getElementById('checkoutHero');
    if (hero && hero.classList) hero.classList.remove('headline-pending');
  }

  function renderVerifiedHeadline(verifiedCount){
    var title = document.getElementById('checkoutTitle');
    if (title) {
      title.textContent = verifiedCount > 0 ? 'Your Second-Chance Matches Are Ready' : 'Your Apartment Options Are Ready';
    }
    if (leadEl) {
      leadEl.textContent = verifiedCount > 0
        ? SECOND_CHANCE_LEAD
        : 'We found apartment options based on your search. Unlock your results free for 7 days.';
    }
    revealHeadline();
  }

  function renderCheckoutMatches(properties){
    var verifiedCount = (Array.isArray(properties) ? properties : []).filter(function(p){
      return p && p.screeningVerification && p.screeningVerification.screeningStatus === 'verified_second_chance';
    }).length;
    renderVerifiedHeadline(verifiedCount);
  }

  // The preview page (just before checkout) already knows the verified
  // count, so use it right away; the results request below confirms it.
  // Without it the headline stays hidden until the request answers, and
  // falls back to the neutral wording if that takes too long.
  function applyRememberedVerifiedCount(answers){
    var remembered = null;
    try { remembered = JSON.parse(sessionStorage.getItem(VERIFIED_COUNT_KEY) || 'null'); } catch (_e) {}
    if (remembered && remembered.leadId === answers.lead_id && typeof remembered.count === 'number') {
      renderVerifiedHeadline(remembered.count);
      return;
    }
    if (typeof setTimeout === 'function') {
      setTimeout(function(){ if (!headlineShown) renderVerifiedHeadline(0); }, HEADLINE_FALLBACK_MS);
    }
  }

  async function hydrateCheckoutMatches(answers, token){
    try {
      var params = 'leadId=' + encodeURIComponent(answers.lead_id) + '&preview=1' + (token ? '&token=' + encodeURIComponent(token) : '');
      var data = await fetchJson('/.netlify/functions/get-apartment-results?' + params);
      renderCheckoutMatches(data.properties || []);
    } catch (err) {
      console.warn('Could not load checkout match preview', err);
      renderCheckoutMatches([]);
    }
  }

  async function init(){
    var token = returnAccessToken();
    var answers = readAnswers();
    var btn = document.getElementById('payBtn');
    if (!answers.lead_id && token) {
      try {
        var access = await fetchJson('/.netlify/functions/return-access?token=' + encodeURIComponent(token));
        if (access && access.lead && access.lead.lead_id) {
          answers = access.lead;
          rememberAnswers(answers);
        }
        if (access && access.entitlements && access.entitlements.listingAccessStatus === 'active') {
          window.location.href = '/real-estate-list?token=' + encodeURIComponent(token);
          return;
        }
      } catch (err) {
        showSetupNote(err.message || 'This secure access link could not be verified.');
      }
    }
    if (!answers.lead_id) {
      window.location.replace(START_URL);
      return;
    }
    hydrateSummary(answers);
    hydrateIntentContext(answers);
    applyRememberedVerifiedCount(answers);
    hydrateCheckoutMatches(answers, token);
    rrTrack('checkout_viewed', marketingContext(answers));

    try {
      try {
        var ent = await fetchJson('/.netlify/functions/get-entitlements?leadId=' + encodeURIComponent(answers.lead_id));
        if (ent && ent.listingAccessStatus === 'active') {
          grantResultsAccess();
          window.location.href = RESULTS_URL;
          return;
        }
      } catch (err) {
        console.warn('Could not load existing entitlement status', err);
      }

      // Stripe.js loads async (it no longer blocks first paint), so wait for
      // it here instead of assuming it is already on the page.
      var StripeCtor = window.Stripe;
      if (!StripeCtor && window.rrnLoadStripeJs) {
        try { StripeCtor = await rrnLoadStripeJs(); } catch (_e) { StripeCtor = null; }
      }
      if (!StripeCtor) throw new Error('Stripe did not load. Refresh the page and try again.');
      var publishableKey = await getStripePublishableKey();
      if (!publishableKey) throw new Error('Stripe publishable key is not configured.');
      stripe = StripeCtor(publishableKey);
      elements = stripe.elements({
        fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap' }],
      });
      var cardStyle = {
        base: {
          color: '#174b33',
          fontFamily: '"DM Sans", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
          fontSize: '16px',
          fontWeight: '600',
          '::placeholder': { color: '#97a69d' },
        },
        invalid: { color: '#a63b32' },
      };
      cardNumber = elements.create('cardNumber', { style: cardStyle, placeholder: '1234 1234 1234 1234' });
      cardExpiry = elements.create('cardExpiry', { style: cardStyle });
      cardCvc = elements.create('cardCvc', { style: cardStyle });
      cardNumber.mount('#cardNumber');
      cardExpiry.mount('#cardExpiry');
      cardCvc.mount('#cardCvc');
      bindElementState(cardNumber, 'cardNumber');
      bindElementState(cardExpiry, 'cardExpiry');
      bindElementState(cardCvc, 'cardCvc');
      btn.disabled = false;
    } catch (err) {
      btn.disabled = true;
      showSetupNote(err.message);
    }
  }

  async function pay(){
    var answers = readAnswers();
    var btn = document.getElementById('payBtn');
    var err = document.getElementById('paymentError');
    var zipInput = document.getElementById('billingZip');
    if (!stripe || !cardNumber || !answers.lead_id || btn.disabled) return;
    rrTrack('checkout_submitted', marketingContext(answers));
    err.classList.remove('show');
    btn.disabled = true;
      btn.textContent = 'Preparing...';
    if (window.rrnShowPaymentOverlay) {
      rrnShowPaymentOverlay({
        title: 'Unlocking your apartment results',
        message: 'Please wait while we securely start your 7-day trial.',
      });
    }

    try {
      if (!paymentClientSecret) {
        await createPrescreenIntent(answers);
      }
      btn.textContent = 'Confirming card...';
      if (window.rrnShowPaymentOverlay) {
        rrnShowPaymentOverlay({
          title: 'Confirming your payment',
          message: 'Please keep this page open while Stripe confirms your purchase.',
        });
      }
      var billingName = [answers.first_name, answers.last_name].filter(Boolean).join(' ') || undefined;
      var result = await stripe.confirmCardSetup(
        paymentClientSecret,
        {
          payment_method: {
            card: cardNumber,
            billing_details: {
              name: billingName,
              email: answers.email || undefined,
              address: {
                postal_code: (zipInput && zipInput.value) || undefined,
                country: 'US',
              },
            },
          },
        }
      );
      if (result.error) {
        var declineError = new Error(PAYMENT_DECLINED_MESSAGE);
        declineError.isPaymentDecline = true;
        throw declineError;
      }

      var stripeSucceeded = result.setupIntent && result.setupIntent.status === 'succeeded';
      setupIntentId = result.setupIntent ? result.setupIntent.id : setupIntentId;
      try {
        var confirmed = await fetchJson('/.netlify/functions/confirm-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leadId: answers.lead_id,
            setupIntentId: setupIntentId,
            product: 'prescreen',
          }),
        });
        if (confirmed.status !== 'succeeded') throw new Error('Payment is still processing. Please try again in a moment.');
      } catch (confirmError) {
        if (!stripeSucceeded) throw confirmError;
        console.warn('Server confirmation failed after Stripe success', confirmError);
      }

      grantResultsAccess();
      rrTrack('review_purchased', marketingContext(answers));
      trackGooglePurchase(setupIntentId);
      if (window.rrnShowPaymentOverlay) {
        rrnShowPaymentOverlay({
          state: 'success',
          title: 'Thank You',
          message: 'Your trial is active. Your RentReady Results are ready.',
        });
      }
      deferNavigation(function(){ window.location.href = RESULTS_URL; }, 800);
    } catch (error) {
      if (window.rrnHidePaymentOverlay) rrnHidePaymentOverlay();
      rrTrack('checkout_payment_failed', Object.assign(marketingContext(answers), { reason: error && error.isPaymentDecline ? 'card_declined' : 'error' }));
      btn.disabled = false;
      btn.textContent = PAY_BUTTON_LABEL;
      showError(error && error.isPaymentDecline ? PAYMENT_DECLINED_MESSAGE : error.message);
    }
  }

  document.getElementById('payBtn').addEventListener('click', pay);
  init();
})();
