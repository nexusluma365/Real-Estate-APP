import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { bootAnalytics } from './lib/analytics';
import { captureAffiliate } from './lib/attribution';
import './styles/global.css';

bootAnalytics();
// Affiliate links can land on any page (?hop=, ?aff=, ?ref=): remember who referred this visitor.
captureAffiliate(window.location.search);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
