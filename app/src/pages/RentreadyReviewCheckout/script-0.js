
(function(){
  var ANSWERS_STORAGE_KEY = 'rrn_answers_v1';
  var FLOW_ACCESS_KEY = 'rrn_flow_access_v1';
  var ENTRY_INTENT_KEY = 'rrn_entry_intent_v1';
  var PRESCREEN_INTENT_KEY = 'rrn_prescreen_payment_intent_v1';
  var RESULTS_URL = '/after-payment-results/';
  var START_URL = '/index.html';
  var FALLBACK_STRIPE_PUBLISHABLE_KEY = 'pk_live_51UFFsZAYPiGDuG9egfnWWGrgNl3YUSIoTAO9FWv6k0UY9auWSr4irlhvuK3yJ2MZhPCgHdCLFt6hTvaGfeZ416bN00nS4e3cYs';
  var PAYMENT_DECLINED_MESSAGE = 'Your Payment Did not go through Please Try again';
  var VALID_ENTRY_INTENTS = ['bad_credit','eviction','broken_lease','denied_application','income_requirements','no_credit','approval_requirements','second_chance','general_renter'];
  var INTENT_MESSAGES = {
    bad_credit: 'Worried about your credit? Your RentReady check looks at more than one part of your rental situation.',
    eviction: 'Renting after an eviction? See what may be worth checking before your next application.',
    broken_lease: 'Have a past broken lease? See what may need attention before you apply again.',
    denied_application: 'Recently denied? Use this check to better understand what to prepare before your next application.',
    income_requirements: 'Not sure if your income fits your rent target? Your RentReady check will help you see the numbers together.',
    no_credit: 'Little or no credit history? See what you may want to prepare before your first application.',
    approval_requirements: "Wondering if you're ready to apply? See how the rental information you provided fits together.",
    second_chance: 'Looking for another chance to rent? Start by understanding your current rental situation.',
    general_renter: 'Save money on Application Fees',
  };
  var stripe = null;
  var elements = null;
  var cardNumber = null;
  var cardExpiry = null;
  var cardCvc = null;
  var paymentIntentId = '';
  var paymentClientSecret = '';

  function readAnswers(){
    try { return JSON.parse(sessionStorage.getItem(ANSWERS_STORAGE_KEY) || localStorage.getItem(ANSWERS_STORAGE_KEY) || '{}') || {}; }
    catch (_e) { return {}; }
  }

  function rrTrack(eventName, detail){
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(Object.assign({ event: eventName }, detail || {}));
      window.dispatchEvent(new CustomEvent('rentready:event', { detail: Object.assign({ event: eventName }, detail || {}) }));
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
    return map[value] || String(value || '').replace(/_/g, ' ') || 'Not provided';
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
    paymentIntentId = intent.paymentIntentId;
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
    var full = [answers.first_name, answers.last_name].filter(Boolean).join(' ') || 'Applicant';
    document.getElementById('summaryName').textContent = full;
    document.getElementById('summaryCity').textContent = answers.preferred_city || 'Not provided';
    document.getElementById('summaryMove').textContent = label(answers.move_timeline, {
      immediately: 'Immediately',
      under_30: 'Under 30 days',
      '30_60_days': '30-60 days',
      '60_plus': '60+ days',
      flexible: 'Flexible',
      one_to_three_months: 'in 1-3 months',
    });
    document.getElementById('summaryCredit').textContent = label(answers.credit_score, {
      under_580: 'Review',
      '580_619': 'Review',
      '620_659': 'Review',
      '660_699': 'Positive',
      '700_739': 'Strong',
      '740_799': 'Strong',
      '800_plus': 'Strong',
    });
  }

  async function init(){
    var answers = readAnswers();
    var btn = document.getElementById('payBtn');
    if (!answers.lead_id) {
      window.location.replace(START_URL);
      return;
    }
    hydrateSummary(answers);
    hydrateIntentContext(answers);
    rrTrack('checkout_viewed', marketingContext(answers));

    try {
      try {
        var ent = await fetchJson('/.netlify/functions/get-entitlements?leadId=' + encodeURIComponent(answers.lead_id));
        if (ent && ent.paid10) {
          grantResultsAccess();
          window.location.href = RESULTS_URL;
          return;
        }
      } catch (err) {
        console.warn('Could not load existing entitlement status', err);
      }

      if (!window.Stripe) throw new Error('Stripe did not load. Refresh the page and try again.');
      var publishableKey = await getStripePublishableKey();
      if (!publishableKey) throw new Error('Stripe publishable key is not configured.');
      stripe = Stripe(publishableKey);
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
    err.classList.remove('show');
    btn.disabled = true;
    btn.textContent = 'Starting secure checkout...';

    try {
      if (!paymentClientSecret) {
        await createPrescreenIntent(answers);
      }
      btn.textContent = 'Confirming payment...';
      var billingName = [answers.first_name, answers.last_name].filter(Boolean).join(' ') || undefined;
      var result = await stripe.confirmCardPayment(
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

      var stripeSucceeded = result.paymentIntent && result.paymentIntent.status === 'succeeded';
      rememberPrescreenPaymentIntent(result.paymentIntent ? result.paymentIntent.id : paymentIntentId);
      try {
        var confirmed = await fetchJson('/.netlify/functions/confirm-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leadId: answers.lead_id,
            paymentIntentId: result.paymentIntent ? result.paymentIntent.id : paymentIntentId,
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
      window.location.href = RESULTS_URL;
    } catch (error) {
      btn.disabled = false;
      btn.innerHTML = 'Continue to Your Approval Odds <span>→</span>';
      showError(error && error.isPaymentDecline ? PAYMENT_DECLINED_MESSAGE : error.message);
    }
  }

  document.getElementById('payBtn').addEventListener('click', pay);
  init();
})();
