import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { FunnelProvider } from './state/FunnelContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ScrollToTop } from './components/Layout';
import { RequireProduct } from './components/Guards';
import { Loader } from './components/ui';
import { INTENTS } from './config/intents';
import Landing from './pages/Landing';
import { ConsentBanner } from './components/ConsentBanner';
import { ExitOffer } from './components/Funnel';

// Funnel entry is eager (fast first paint for ad traffic); everything after is code-split.
const Start = lazy(() => import('./pages/Start'));
const Learn = lazy(() => import('./pages/Learn'));
const CreditReady = lazy(() => import('./pages/CreditReady'));
const Checkout = lazy(() => import('./pages/Checkout'));
const Upsell = lazy(() => import('./pages/Upsell'));
const Welcome = lazy(() => import('./pages/Welcome'));
const Assessment = lazy(() => import('./pages/Assessment'));
const Gameplan = lazy(() => import('./pages/Gameplan'));
const Access = lazy(() => import('./pages/Access'));
const Checklist = lazy(() => import('./pages/Checklist'));
const Admin = lazy(() => import('./pages/Admin'));
const NotFound = lazy(() => import('./pages/NotFound'));

export default function App() {
  return (
    <BrowserRouter>
      <FunnelProvider>
        <ScrollToTop />
        <ConsentBanner />
        <ErrorBoundary>
          <Suspense fallback={<Loader />}>
            <Routes>
              {/* Step 1 — Awareness (+ Google Ads message-match pages) */}
              <Route path="/" element={<Landing />} />
              {INTENTS.map((i) => (
                <Route key={i.slug} path={`/${i.slug}`} element={<Landing intent={i} />} />
              ))}
              {/* Step 2 — Opt-in */}
              <Route path="/start" element={<Start />} />
              {/* Step 3 — Consideration */}
              <Route path="/learn" element={<Learn />} />
              {/* Step 4 — Desire */}
              <Route path="/creditready" element={<CreditReady />} />
              {/* Free resource for visitors who aren't ready to buy */}
              <Route path="/checklist" element={<Checklist />} />
              {/* Step 5 — Checkout (collects name + email inline when there's no lead yet) */}
              <Route path="/checkout" element={<Checkout />} />
              {/* Step 6 — Upsell / Congratulations / Onboarding (server-verified access) */}
              <Route path="/complete-your-system" element={<RequireProduct product="creditready"><Upsell /></RequireProduct>} />
              <Route path="/welcome" element={<RequireProduct product={['creditready', 'guide']}><Welcome /></RequireProduct>} />
              <Route path="/assessment" element={<RequireProduct product="creditready"><Assessment /></RequireProduct>} />
              <Route path="/gameplan" element={<RequireProduct product="creditready"><Gameplan /></RequireProduct>} />
              {/* Step 7 — Retention & advocacy */}
              <Route path="/access" element={<Access />} />
              {/* Funnel dashboard (token-protected API; not linked anywhere) */}
              <Route path="/admin" element={<Admin />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
        <ExitOffer />
      </FunnelProvider>
    </BrowserRouter>
  );
}
