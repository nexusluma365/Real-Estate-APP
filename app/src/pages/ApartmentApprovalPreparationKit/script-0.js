
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
        try { rrnGrantFlowAccess('apartment-list', { status: 'upsell-skipped', category: listingCategory(), city: selectedCity() }); } catch (_e) {}
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

      let status = 'failed';
      try {
        const stripeKey = await rrnGetStripePublishableKey(STRIPE_PUBLISHABLE_KEY);
        status = await rrnChargeUpsell(UPSELL_PRODUCT, stripeKey);
      } catch (_e) {
        status = 'failed';
      }

      if (status === 'succeeded') {
        await continueToRealEstateList();
        return;
      }

      if (status === 'processing') {
        pollForApartmentPrepCompletion();
        return;
      }

      showDeclinedPopup();
      resetCheckoutButton();
    }

    async function continueToRealEstateList() {
      try { rrnGrantFlowAccess('apartment-list', { status: 'upsell-success', category: listingCategory(), city: selectedCity() }); } catch (_e) {}
      window.location.href = realEstateListUrl();
    }

    function pollForApartmentPrepCompletion() {
      let attempts = 0;
      const check = async () => {
        attempts++;
        const entitlements = await rrnFetchEntitlements(rrnLeadId());
        if (entitlements && entitlements.paid27 && (entitlements.purchasedCategories || []).includes(UPSELL_PRODUCT)) {
          await continueToRealEstateList();
          return;
        }
        if (attempts >= 6) {
          showDeclinedPopup();
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
      const city = selectedCity();
      try { rrnGrantFlowAccess('apartment-list', { status: 'upsell-declined', category: listingCategory(), city }); } catch (_e) {}
      sheetTitle.textContent = "We Couldn’t Complete Your Purchase Yet.";
      showSheetMessage(`You can continue to your RentReady listings for ${city} and try the Apartment Approval Preparation Kit again when you’re ready.`);
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
      sheetScrim.classList.remove('auto-redirect');
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

    function listingCategory() {
      try {
        const params = new URLSearchParams(window.location.search);
        const fromUrl = String(params.get('category') || params.get('style') || '').toLowerCase();
        if (fromUrl === 'modern') return 'modern';
        if (fromUrl === 'luxury') return 'luxury';
        const answers = JSON.parse(sessionStorage.getItem('rrn_answers_v1') || localStorage.getItem('rrn_answers_v1') || '{}') || {};
        const fromAnswers = String(answers.apartment_style || answers.style || answers.preferred_style || '').toLowerCase();
        return fromAnswers === 'modern' ? 'modern' : 'luxury';
      } catch (_e) {
        return 'luxury';
      }
    }

    function realEstateListUrl() {
      const params = new URLSearchParams({ category: listingCategory(), city: selectedCity() });
      const leadId = window.rrnLeadId ? rrnLeadId() : '';
      if (leadId) params.set('leadId', leadId);
      return '/real-estate-list.html?' + params.toString();
    }
