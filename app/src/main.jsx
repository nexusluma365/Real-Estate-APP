import React from 'react';
import ReactDOM from 'react-dom/client';
import './manychat.js';
import App from './App.jsx';

// StrictMode is intentionally not used: every route mounts an imperative
// legacy page script (timers, fetches, payment flows). StrictMode's dev-only
// double-mount would run each of those twice, producing duplicate requests
// and racing timers that never happen in production.
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
