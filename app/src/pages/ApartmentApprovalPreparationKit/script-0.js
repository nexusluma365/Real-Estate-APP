
    // ---- scroll reveal (single pass per section) ----
    const revealEls = document.querySelectorAll('.reveal');
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('show');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.16 });
    revealEls.forEach(el => revealObserver.observe(el));

    // ---- checkout flow -----------------------------------------------
    const UPSELL_PRODUCT = 'apartment_prep';
    const STRIPE_PUBLISHABLE_KEY = 'pk_test_51UFFsZAYPiGDuG9e6Y8IS6i69lBTeKG9VLmMNUH6J0Ku6SrjzTOfqJZeEi2rrfri2Ive2zL4trt4fSXCWnLRVMSS00RNMFJPu4';
    const START_URL = '/index.html';

    const learnMoreBtn = document.getElementById('learnMoreBtn');
    const howSection = document.getElementById('heresHow');
    const sheetScrim = document.getElementById('sheetScrim');
    const sheetCancel = document.getElementById('sheetCancel');
    const sheetConfirm = document.getElementById('sheetConfirm');
    const continueListingsLink = document.getElementById('continueListingsLink');
    const keysCtaBtn = document.getElementById('keysCtaBtn');
    const pageRoot = document.querySelector('.apartment-prep-page');
    const sheetSub = sheetScrim.querySelector('.sub');
    const sheetTitle = sheetScrim.querySelector('h4');
    const originalConfirmText = 'Continue to Listings';

    if (learnMoreBtn) {
      learnMoreBtn.addEventListener('click', (e) => {
        e.preventDefault();
        scrollToHowSection();
      });
    }
    if (keysCtaBtn) keysCtaBtn.addEventListener('click', handleApartmentPrepPurchase);
    sheetCancel.addEventListener('click', () => {
      sheetScrim.classList.remove('open');
      resetSheetMessage();
    });
    sheetScrim.addEventListener('click', (e) => {
      if (e.target === sheetScrim) {
        sheetScrim.classList.remove('open');
        resetSheetMessage();
      }
    });

    sheetConfirm.addEventListener('click', () => {
      window.location.href = sheetConfirm.dataset.target || realEstateListUrl();
    });

    if (continueListingsLink) {
      continueListingsLink.addEventListener('click', (e) => {
        e.preventDefault();
        try { rrnGrantFlowAccess('apartment-list', { status: 'upsell-skipped', city: selectedCity() }); } catch (_e) {}
        window.location.href = realEstateListUrl();
      });
    }

    requireUpsellAccess();

    async function requireUpsellAccess() {
      if (isLocalPreview()) return;

      const leadId = window.rrnLeadId ? rrnLeadId() : null;
      if (!leadId) {
        window.location.replace(START_URL);
        return;
      }

      try {
        const entitlements = await rrnFetchEntitlements(leadId);
        if (entitlements && entitlements.paid10) return;
      } catch (_e) {}

      if (window.rrnHasRecentFlowAccess && rrnHasRecentFlowAccess('prescreen-results', { statuses: ['confirmed'] })) return;
      window.location.replace(START_URL);
    }

    function isLocalPreview() {
      const host = window.location && window.location.hostname;
      return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
    }

    function scrollToHowSection() {
      if (!howSection) return;
      howSection.classList.add('show');
      const appShell = document.querySelector('.app');
      const sectionTop = howSection.getBoundingClientRect().top;
      const scrollTarget = sectionTop + window.pageYOffset;
      if (appShell && appShell.scrollHeight > appShell.clientHeight) {
        appShell.scrollTo({ top: howSection.offsetTop, behavior: 'smooth' });
        return;
      }
      window.scrollTo({ top: scrollTarget, behavior: 'smooth' });
    }

    async function handleApartmentPrepPurchase() {
      if (!keysCtaBtn || keysCtaBtn.dataset.busy === '1') return;
      if (!window.rrnLeadId || !rrnLeadId()) {
        showDeclinedPopup();
        return;
      }

      keysCtaBtn.dataset.busy = '1';
      keysCtaBtn.classList.add('is-loading');
      keysCtaBtn.disabled = true;
      showPaymentStatus('processing');

      let status = 'failed';
      try {
        const stripeKey = await rrnGetStripePublishableKey(STRIPE_PUBLISHABLE_KEY);
        status = await rrnChargeUpsell(UPSELL_PRODUCT, stripeKey);
      } catch (_e) {
        status = 'failed';
      }

      if (status === 'succeeded') {
        showPaymentStatus('success');
        setTimeout(continueToRealEstateList, 1400);
        return;
      }

      if (status === 'processing') {
        pollForApartmentPrepCompletion();
        return;
      }

      showTroubleAndRedirect();
      resetCheckoutButton();
    }

    async function continueToRealEstateList() {
      try { rrnGrantFlowAccess('apartment-list', { status: 'upsell-success', city: selectedCity() }); } catch (_e) {}
      window.location.href = realEstateListUrl();
    }

    function pollForApartmentPrepCompletion() {
      let attempts = 0;
      const check = async () => {
        attempts++;
        let entitlements = null;
        try {
          entitlements = await rrnFetchEntitlements(rrnLeadId());
          const purchasedCategories = (entitlements && entitlements.purchasedCategories) || [];
          if (entitlements && (entitlements.paid47 || entitlements.paid27) && (entitlements.purchasedCategory === UPSELL_PRODUCT || purchasedCategories.includes(UPSELL_PRODUCT))) {
            showPaymentStatus('success');
            setTimeout(continueToRealEstateList, 1400);
            return;
          }
        } catch (_e) {}
        if (attempts >= 6) {
          showTroubleAndRedirect();
          resetCheckoutButton();
          return;
        }
        setTimeout(check, 1500);
      };
      setTimeout(check, 1500);
    }

    function resetCheckoutButton() {
      if (!keysCtaBtn) return;
      keysCtaBtn.classList.remove('is-loading');
      keysCtaBtn.disabled = false;
      keysCtaBtn.dataset.busy = '0';
    }

    function showDeclinedPopup() {
      showTroubleAndRedirect();
    }

    function showPaymentStatus(state) {
      if (!sheetScrim || !sheetTitle || !sheetSub) return;
      if (pageRoot) pageRoot.classList.add('is-payment-overlay-open');
      sheetScrim.classList.remove('auto-redirect', 'payment-processing', 'payment-success', 'payment-failed');
      sheetScrim.classList.add('payment-status');
      sheetConfirm.disabled = true;
      sheetConfirm.dataset.busy = '1';
      delete sheetConfirm.dataset.target;

      if (state === 'success') {
        sheetScrim.classList.add('payment-success');
        sheetTitle.textContent = 'Thank You';
        sheetSub.textContent = 'Your RentReady Kit download link is being sent to your email. Taking you to your apartment listings now.';
      } else if (state === 'failed') {
        sheetScrim.classList.add('payment-failed');
        sheetTitle.textContent = 'Sorry We Having Trouble, but No worries';
        sheetSub.textContent = 'Taking you to your apartment listings now.';
      } else {
        sheetScrim.classList.add('payment-processing');
        sheetTitle.textContent = 'Processing your RentReady Kit';
        sheetSub.textContent = 'Please wait while we complete your $47 purchase.';
      }
      sheetScrim.classList.add('open');
    }

    function showTroubleAndRedirect() {
      const city = selectedCity();
      try { rrnGrantFlowAccess('apartment-list', { status: 'upsell-declined', city }); } catch (_e) {}
      showPaymentStatus('failed');
      sheetConfirm.textContent = originalConfirmText;
      sheetConfirm.disabled = false;
      sheetConfirm.dataset.busy = '0';
      sheetConfirm.dataset.target = realEstateListUrl();
      sheetScrim.classList.add('auto-redirect');
      sheetScrim.classList.add('open');
      setTimeout(() => {
        window.location.href = realEstateListUrl();
      }, 1800);
    }

    function showSheetMessage(message) {
      sheetSub.textContent = message;
    }

    function resetSheetMessage() {
      if (sheetConfirm.dataset.busy === '1') return;
      if (pageRoot) pageRoot.classList.remove('is-payment-overlay-open');
      sheetScrim.classList.remove('auto-redirect');
      sheetScrim.classList.remove('payment-status', 'payment-processing', 'payment-success', 'payment-failed');
      sheetTitle.textContent = "We Couldn’t Complete Your Upgrade Yet.";
      sheetSub.textContent = `You can continue to your RentReady listings for ${selectedCity()} and try the Apartment Approval Preparation Kit again when you’re ready.`;
      sheetConfirm.textContent = originalConfirmText;
      delete sheetConfirm.dataset.target;
    }

    function selectedCity() {
      try {
        const answers = JSON.parse(sessionStorage.getItem('rrn_answers_v1') || localStorage.getItem('rrn_answers_v1') || '{}') || {};
        return answers.preferred_city || answers.city || 'your selected area';
      } catch (_e) {
        return 'your selected area';
      }
    }

    function realEstateListUrl() {
      const params = new URLSearchParams();
      const leadId = window.rrnLeadId ? rrnLeadId() : '';
      if (leadId) params.set('leadId', leadId);
      const prescreenPaymentIntentId = window.rrnPrescreenPaymentIntentId ? rrnPrescreenPaymentIntentId() : '';
      const apartmentPrepPaymentIntentId = window.rrnApartmentPaymentIntentId ? rrnApartmentPaymentIntentId(UPSELL_PRODUCT) : '';
      if (prescreenPaymentIntentId) params.set('prescreenPaymentIntentId', prescreenPaymentIntentId);
      if (apartmentPrepPaymentIntentId) params.set('apartmentPrepPaymentIntentId', apartmentPrepPaymentIntentId);
      const city = selectedCity();
      if (city && city !== 'your selected area') params.set('city', city);
      const query = params.toString();
      return '/real-estate-list.html' + (query ? '?' + query : '');
    }
