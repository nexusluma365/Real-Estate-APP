# RentReady — React app

This is the same site, restructured as a single React app (Vite + React
Router) instead of 11 separate static HTML pages. Every page's original
design, CSS, and JS logic is unchanged — see MIGRATION_NOTES.md at the repo
root for exactly what changed and why.

## Run it locally

You need TWO processes running at once: the Netlify Functions backend, and
the React app's dev server.

```bash
# from the repo root — starts netlify dev (functions + local env vars)
netlify dev

# in a second terminal — starts the React app
cd app
npm install
npm run dev
```

Open the URL `npm run dev` prints (default `http://localhost:5173`). API
calls to `/.netlify/functions/*` are automatically proxied to `netlify dev`
(default `http://localhost:8888`) — see `app/vite.config.js` if your
`netlify dev` runs on a different port.

Make sure a real `.env` file exists at the repo root (gitignored) with your
actual Stripe/Google/OpenAI keys — `netlify dev` reads it automatically.
`.env.example` is just the template.

## Build for production

```bash
cd app
npm install
npm run build
```

Output goes to `app/dist`. You won't normally run this yourself — Netlify
runs it automatically on every push, per `netlify.toml`'s `[build]`
section.

## Deploying

Nothing changes about how you deploy — same Netlify site, same git push.
`netlify.toml` now points Netlify at `cd app && npm install && npm run
build` for the build command and `app/dist` as the publish directory.
`netlify/functions` is untouched and still deploys the same way it always
did.

## Project layout

```
netlify/functions/     ← unchanged — your existing backend
netlify.toml            ← updated: builds the app, publishes app/dist
app/
  index.html            ← the SPA shell (loads Stripe.js + checkout-client.js once, globally)
  src/
    App.jsx             ← routes — one per original page, plus alias routes
                           for the old hardcoded .html paths pages navigate to internally
    legacy/
      useLegacyPage.js   ← mounts/unmounts a page's original style+body+scripts
      runLegacyScript.js ← runs a page's original <script> content unchanged
    pages/<PageName>/
      page.html          ← verbatim body markup from the original .html file
      page.css           ← verbatim <style> content
      head-extras.html   ← that page's font <link> tags
      script-0.js         ← verbatim inline <script> content
      index.jsx          ← thin wrapper wiring the above into a React component
  public/
    assets/checkout-client.js   ← copied verbatim, now loaded once globally
    real estate images/, hero images, generated images  ← copied verbatim
```

The original standalone .html files (index.html, real-estate-list.html,
etc.) are still sitting at the repo root. They are no longer part of the
deployed site (only `app/dist` is published) — they're just the source
material the migration script read from. Safe to delete once you've
confirmed the app works, or keep them as a reference.

## If you need to re-extract a page

If you ever hand-edit one of the original root .html files and want to
pull those changes into the app instead of manually editing the
`app/src/pages/.../page.*` files, re-run:

```bash
node scripts/migrate-pages-to-react.mjs
```

It regenerates every page's `page.html` / `page.css` / `script-*.js` /
`index.jsx` from the root .html files. Any manual edits you'd made
directly inside `app/src/pages/` will be overwritten, so treat the root
`.html` files as the source of truth if you use this workflow.
