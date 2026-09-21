import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// Lazy-loaded per route so each page's own CSS/JS/HTML (some of which
// embeds large base64 images straight from the original design) only
// downloads when that page is actually visited, instead of every page's
// assets being bundled into one multi-megabyte chunk loaded on first visit.
// This only changes bundling — none of the imported files' content changes.
const Questionnaire = lazy(() => import('./pages/Questionnaire/index.jsx'));
const LuxuryApartmentsPremium = lazy(() => import('./pages/LuxuryApartmentsPremium/index.jsx'));
const ModernApartmentsPremium = lazy(() => import('./pages/ModernApartmentsPremium/index.jsx'));
const RealEstateList = lazy(() => import('./pages/RealEstateList/index.jsx'));
const AfterPaymentResults = lazy(() => import('./pages/AfterPaymentResults/index.jsx'));
const RentreadyReviewCheckout = lazy(() => import('./pages/RentreadyReviewCheckout/index.jsx'));
const CreditActionPackage = lazy(() => import('./pages/CreditActionPackage/index.jsx'));
const GamePlan = lazy(() => import('./pages/GamePlan/index.jsx'));
const Membership = lazy(() => import('./pages/Membership/index.jsx'));
const ThankYou = lazy(() => import('./pages/ThankYou/index.jsx'));
const ResultsProcessing = lazy(() => import('./pages/ResultsProcessing/index.jsx'));
const Legal = lazy(() => import('./pages/Legal/index.jsx'));
const Home = lazy(() => import('./pages/Home/index.jsx'));
const IntentLanding = lazy(() => import('./pages/IntentLanding/index.jsx'));

// Every path here matches the original standalone .html page's URL exactly
// (netlify.toml's pretty_urls + existing redirects already made these the
// canonical, user-facing paths). Same URLs in, same URLs out — only how the
// browser gets from one to the next has changed (client-side route swap
// instead of a full page reload).
export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/index.html" element={<Home />} />

          <Route path="/check-my-rental-readiness" element={<Questionnaire />} />
          <Route path="/check-my-rental-readiness/" element={<Questionnaire />} />

          <Route path="/apartments-with-bad-credit" element={<IntentLanding intentKey="bad_credit" />} />
          <Route path="/rent-after-eviction" element={<IntentLanding intentKey="eviction" />} />
          <Route path="/rent-after-broken-lease" element={<IntentLanding intentKey="broken_lease" />} />
          <Route path="/apartment-application-denied" element={<IntentLanding intentKey="denied_application" />} />
          <Route path="/apartment-income-requirements" element={<IntentLanding intentKey="income_requirements" />} />
          <Route path="/first-apartment-no-credit" element={<IntentLanding intentKey="no_credit" />} />
          <Route path="/apartment-approval-requirements" element={<IntentLanding intentKey="approval_requirements" />} />
          <Route path="/second-chance-apartments" element={<IntentLanding intentKey="second_chance" />} />

          <Route path="/luxury-apartments-premium" element={<LuxuryApartmentsPremium />} />
          <Route path="/luxury-apartments-premium.html" element={<LuxuryApartmentsPremium />} />

          <Route path="/modern-apartments-premium" element={<ModernApartmentsPremium />} />
          <Route path="/modern-apartments-premium.html" element={<ModernApartmentsPremium />} />

          <Route path="/real-estate-list" element={<RealEstateList />} />
          <Route path="/real-estate-list.html" element={<RealEstateList />} />

          {/* Trailing slash included: several pages' own scripts navigate to
              this exact string ('/after-payment-results/'), inherited from
              when it was a folder with its own index.html. */}
          <Route path="/after-payment-results" element={<AfterPaymentResults />} />
          <Route path="/after-payment-results/" element={<AfterPaymentResults />} />

          <Route path="/rentready-review-checkout" element={<RentreadyReviewCheckout />} />

          <Route path="/credit-action-package" element={<CreditActionPackage />} />
          <Route path="/credit-action-package.html" element={<CreditActionPackage />} />

          <Route path="/game-plan" element={<GamePlan />} />
          <Route path="/game-plan.html" element={<GamePlan />} />

          <Route path="/membership" element={<Membership />} />
          <Route path="/membership.html" element={<Membership />} />

          <Route path="/thank-you" element={<ThankYou />} />
          <Route path="/thank-you.html" element={<ThankYou />} />

          <Route path="/results-processing" element={<ResultsProcessing />} />
          <Route path="/results-processing.html" element={<ResultsProcessing />} />

          <Route path="/privacy" element={<Legal type="privacy" />} />
          <Route path="/terms" element={<Legal type="terms" />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
