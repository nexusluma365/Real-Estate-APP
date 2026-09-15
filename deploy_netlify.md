# Netlify Deployment Notes

## What is ready
- `app/index.html` is the production entry page for the Vite app.
- `netlify.toml` is configured for:
  - `cd app && npm install && npm run build`
  - `app/dist` publish
  - html no-cache
  - long-cache static images
  - security headers
  - friendly route redirects

## Deploy
1. Push this folder to GitHub.
2. In Netlify, create a new site from that repo.
3. Build command: `cd app && npm install && npm run build`
4. Publish directory: `app/dist`
5. Deploy.

## Post-deploy checks
1. Open `/` and verify the questionnaire loads.
2. Submit a test lead and confirm row appears in Google Sheet.
3. Open `/.netlify/functions/config` and verify it returns `ok: true`.
4. Add the Stripe webhook URL: `https://YOUR_NETLIFY_DOMAIN/.netlify/functions/stripe-webhook`.
5. Test mobile/tablet layouts with browser responsive mode.
