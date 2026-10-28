import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { bootAnalytics } from './lib/analytics';
import './styles/global.css';

bootAnalytics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
