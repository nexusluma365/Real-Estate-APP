
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
    const APARTMENT_CATEGORY = 'modern';
    const STRIPE_PUBLISHABLE_KEY = '';
    const START_URL = '/index.html';

    const checkoutBtn = document.getElementById('checkoutBtn');
    const sheetScrim = document.getElementById('sheetScrim');
    const sheetCancel = document.getElementById('sheetCancel');
    const sheetConfirm = document.getElementById('sheetConfirm');
    const sheetSub = sheetScrim.querySelector('.sub');
    const sheetTitle = sheetScrim.querySelector('h4');
    const originalConfirmText = 'Continue to Listings';

    checkoutBtn.addEventListener('click', handleModernPurchase);
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

    requireUpsellAccess();

    async function requireUpsellAccess() {
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

    async function handleModernPurchase() {
      if (checkoutBtn.dataset.busy === '1') return;
      if (!window.rrnLeadId || !rrnLeadId()) {
        showDeclinedPopup();
        return;
      }

      checkoutBtn.dataset.busy = '1';
      checkoutBtn.classList.add('is-loading');
      checkoutBtn.disabled = true;

      let status = 'failed';
      try {
        const stripeKey = await rrnGetStripePublishableKey(STRIPE_PUBLISHABLE_KEY);
        status = await rrnChargeUpsell(APARTMENT_CATEGORY, stripeKey);
      } catch (_e) {
        status = 'failed';
      }

      if (status === 'succeeded') {
        await continueToRealEstateList();
        return;
      }

      if (status === 'processing') {
        pollForModernCompletion();
        return;
      }

      showDeclinedPopup();
      resetCheckoutButton();
    }

    async function continueToRealEstateList() {
      try { rrnGrantFlowAccess('apartment-list', { status: 'upsell-success', category: APARTMENT_CATEGORY, city: selectedCity() }); } catch (_e) {}
      try { await rrnEmailAsset('apartment-results', APARTMENT_CATEGORY); } catch (_e) {}
      window.location.href = realEstateListUrl();
    }

    function pollForModernCompletion() {
      let attempts = 0;
      const check = async () => {
        attempts++;
        const entitlements = await rrnFetchEntitlements(rrnLeadId());
        if (entitlements && entitlements.paid27 && entitlements.purchasedCategory === APARTMENT_CATEGORY) {
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
      checkoutBtn.classList.remove('is-loading');
      checkoutBtn.disabled = false;
      checkoutBtn.dataset.busy = '0';
    }

    function showDeclinedPopup() {
      const city = selectedCity();
      try { rrnGrantFlowAccess('apartment-list', { status: 'upsell-declined', category: APARTMENT_CATEGORY, city }); } catch (_e) {}
      sheetTitle.textContent = "We Couldn’t Complete Your Upgrade Yet.";
      showSheetMessage(`Returning you to your RentReady listings. You can retry Modern Apartment Listings for ${city} when you’re ready.`);
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
      sheetSub.textContent = `Returning you to your RentReady listings. You can retry Modern Apartment Listings in ${selectedCity()} when you’re ready.`;
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
      const params = new URLSearchParams({ category: APARTMENT_CATEGORY, city: selectedCity() });
      const leadId = window.rrnLeadId ? rrnLeadId() : '';
      if (leadId) params.set('leadId', leadId);
      return '/real-estate-list.html?' + params.toString();
    }
