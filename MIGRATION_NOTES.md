# Migration notes: multi-page HTML → single React app

## What changed
- Added `app/` — a Vite + React + React Router project that is now the
  entire frontend. It replaces the 11 standalone `.html` pages that used to
  be deployed directly.
- Updated `netlify.toml`: build command now builds `app/`, publish
  directory is `app/dist`, and URL aliases/redirects were retargeted from
  physical `.html` files to the new client-side routes.
- Everything under `netlify/functions/` is **unchanged**.

## What did NOT change
- No page's visual design, CSS, or copy.
- No business logic: Stripe checkout flow, entitlement gating (`paid10`,
  `paid27`, `purchasedCategory`), Google Places / OpenAI calls, the
  sessionStorage-based hand-off between steps (`rrn_answers_v1`, etc.) —
  all identical to before.
- Every page's inline `<script>` content is byte-for-byte identical to the
  original file (verified programmatically during migration — see below).

## How the migration was done
`scripts/migrate-pages-to-react.mjs` mechanically extracted each page's
`<title>`, font `<link>` tags, `<style>` block, body markup (with `<script>`
tags stripped out), and inline script contents into separate files under
`app/src/pages/<PageName>/`, then generated a thin React component
(`index.jsx`) that feeds those extracted files into a shared
`useLegacyPage` hook. Nothing was retyped or reformatted by hand — every
extracted `page.css` and `script-*.js` was diffed against the original
`.html` file's `<style>`/`<script>` blocks and confirmed identical before
this migration was considered done.

Two behavioral shims were needed to make old page-load-time code work
inside a single-page app, both purely mechanical (no logic changes):

1. **`window.addEventListener("load", ...)` → runs immediately on mount.**
   In a real multi-page site, each page's own `load` event fires when that
   page's HTML finishes parsing. In a SPA, the browser's `load` event fires
   once for the whole shell — it will never fire again on a client-side
   route change. `runLegacyScript` intercepts `addEventListener('load', ...)`
   and `addEventListener('DOMContentLoaded', ...)` calls made by the page's
   own script and invokes them immediately instead, since by the time the
   script runs, that page's DOM is already present. Only `index.html`
   (Questionnaire) and `real-estate-list.html` used this pattern; every
   other page's init code ran at the top level of its script and needed no
   change.

2. **Hardcoded internal navigation targets got alias routes.** Several
   pages navigate between each other using hardcoded strings like
   `/game-plan.html`, `/membership.html`, `/after-payment-results/` (with
   trailing slash), or `/real-estate-list.html?...`. These strings live
   inside the untouched script content, so instead of editing them
   (which would violate "don't change the logic"), `app/src/App.jsx` adds
   an explicit route for every one of these exact strings, alongside the
   new clean-URL route, both rendering the same page component. Found via
   an exhaustive grep across every extracted script and page body — see
   the list in `App.jsx`'s comments.

## Known follow-up (not done, optional)
- `modern-apartments-premium.html` and `luxury-apartments-premium.html`
  embed large base64 images directly in their original HTML (not something
  introduced by this migration — the original files were already ~1–2MB
  each for this reason). Route-level code-splitting (`React.lazy`) means
  these only load when a user actually visits those two pages, but
  extracting those images into real image files would shrink them further.
  Skipped for now since it would mean editing those two pages' markup.
- Internal navigation still uses full `window.location.href` page loads
  (not React Router's client-side `navigate()`), because that's exactly
  how the original site worked and changing it would touch the logic
  inside each page's script. It works correctly as-is; it just means a
  full round-trip through the browser (and a brief blank flash) on every
  step, the same as before. Swapping these to client-side navigation later
  would remove that flash, but is an optional follow-up, not a fix for
  anything broken today.
