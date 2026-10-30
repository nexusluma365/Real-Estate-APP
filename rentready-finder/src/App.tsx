import { lazy, Suspense } from 'react';
import { BrowserRouter, HashRouter, Link, Route, Routes } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { FinderProvider } from './context/FinderContext';
import { Navbar } from './components/layout/Navbar';
import { Footer } from './components/layout/Footer';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { HomePage } from './pages/HomePage';
import { Skeleton } from './components/ui/Loader';

// The home page (search + results) is in the first download; detail pages load when opened.
const PropertyDetailsPage = lazy(() => import('./pages/PropertyDetailsPage').then((m) => ({ default: m.PropertyDetailsPage })));
const ListingDetailsPage = lazy(() => import('./pages/ListingDetailsPage').then((m) => ({ default: m.ListingDetailsPage })));

/** Same shape as the detail pages' own loading state, so nothing jumps when the page arrives. */
function DetailFallback() {
  return (
    <div className="min-h-screen bg-offwhite pb-24 pt-[100px]" aria-busy="true">
      <div className="container-site">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-6 h-[380px] !rounded-[24px]" />
      </div>
    </div>
  );
}
import { IntroLoader } from './components/ui/HelloLoader';
import { MemberProvider } from './context/MemberContext';
import { MembershipOffer } from './components/premium/MembershipOffer';
import { PremiumReturnNotice } from './components/premium/PremiumReturnNotice';

declare const __ROUTER_MODE__: 'hash' | 'browser';

function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 pt-24 text-center">
      <h1 className="text-[30px] font-semibold text-navy-900">Page not found</h1>
      <Link to="/" className="mt-5 font-semibold text-gold-700 hover:underline">
        Return home
      </Link>
    </div>
  );
}

function Shell() {
  return (
    <FinderProvider>
      <MemberProvider>
        <IntroLoader />
        <PremiumReturnNotice />
        <MembershipOffer />
        <a href="#search" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-navy-900">
          Skip to search
        </a>
        <Navbar />
        <main>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/property/:placeId" element={<Suspense fallback={<DetailFallback />}><PropertyDetailsPage /></Suspense>} />
            <Route path="/listing/:id" element={<Suspense fallback={<DetailFallback />}><ListingDetailsPage /></Suspense>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <Footer />
      </MemberProvider>
    </FinderProvider>
  );
}

export default function App() {
  const Router = __ROUTER_MODE__ === 'hash' ? HashRouter : BrowserRouter;
  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <Router basename={__ROUTER_MODE__ === 'hash' ? undefined : '/finder'}>
          <Shell />
        </Router>
      </MotionConfig>
    </ErrorBoundary>
  );
}
