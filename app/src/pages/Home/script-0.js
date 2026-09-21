(function(){
  var INTENT_KEY = 'rrn_entry_intent_v1';
  var VALID = ['bad_credit','eviction','broken_lease','denied_application','income_requirements','no_credit','approval_requirements','second_chance','general_renter'];

  function readIntent(){
    try {
      var sessionValue = sessionStorage.getItem(INTENT_KEY);
      if (VALID.indexOf(sessionValue) >= 0) return sessionValue;
      var localValue = localStorage.getItem(INTENT_KEY);
      if (VALID.indexOf(localValue) >= 0) return localValue;
    } catch (_e) {}
    return '';
  }

  function storeIntent(value, overwriteSpecific){
    if (VALID.indexOf(value) < 0) return;
    var existing = readIntent();
    if (!overwriteSpecific && existing && existing !== 'general_renter') return;
    try { sessionStorage.setItem(INTENT_KEY, value); } catch (_e) {}
    try { localStorage.setItem(INTENT_KEY, value); } catch (_e) {}
  }

  function marketingContext(){
    var params = new URLSearchParams(window.location.search || '');
    return {
      entry_intent: readIntent() || 'general_renter',
      landing_page: window.location.pathname || '/',
      utm_source: params.get('utm_source') || '',
      utm_medium: params.get('utm_medium') || '',
      utm_campaign: params.get('utm_campaign') || '',
      utm_term: params.get('utm_term') || '',
      utm_content: params.get('utm_content') || '',
    };
  }

  function rrTrack(eventName, detail){
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(Object.assign({ event: eventName }, detail || {}));
      window.dispatchEvent(new CustomEvent('rentready:event', { detail: Object.assign({ event: eventName }, detail || {}) }));
    } catch (_e) {}
  }

  document.querySelectorAll('[data-general-cta]').forEach(function(link){
    link.addEventListener('click', function(){
      storeIntent('general_renter', false);
      rrTrack('intent_cta_click', marketingContext());
    });
  });
})();
