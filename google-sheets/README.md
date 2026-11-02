# Questionnaire answers → Google Sheets

Every finished apartment-match questionnaire (`/find-my-apartment`) is added as one row to a Google Sheet:
submitted time, first name, email, marketing opt-in, city/ZIP, move timing, budget, bedrooms, rental concerns,
lead ID and the ad source (UTM / Google Ads click). The RentReady server writes the row after the visitor gives their
name and email; answers are never sent to analytics or ad platforms.

## Set up (about 5 minutes)

1. **Create a secret.** In Terminal: `openssl rand -hex 32` — copy the result.
2. **Create the Sheet.** New Google Sheet (e.g. "RentReady — Questionnaire answers"). Keep it private; share it only with people who need it.
3. **Add the script.** In the Sheet: Extensions → Apps Script. Delete what's there, paste all of `Code.gs` from this folder,
   and replace `PASTE-THE-SAME-LONG-RANDOM-SECRET-AS-NETLIFY` with your secret. Save.
4. **Deploy it.** Deploy → New deployment → type **Web app** → Execute as **Me** → Who has access **Anyone** → Deploy.
   Approve the permissions (it only needs this spreadsheet). Copy the **Web app URL** (ends in `/exec`).
5. **Tell Netlify.** Site configuration → Environment variables, add (mark both as secret):
   - `GOOGLE_SHEETS_WEBHOOK_URL` = the `/exec` URL
   - `GOOGLE_SHEETS_WEBHOOK_SECRET` = the same secret
   Then redeploy (Deploys → Trigger deploy).
6. **Check it.** Complete the questionnaire on the live site with a test email. A "Questionnaire" tab with a header row
   and your answers appears within a few seconds. `/api/admin/health` shows `"google_sheets": true`.

"Anyone" access is required for a server to reach the script; the secret is what stops anyone else from adding rows.
If you edit the script later, use Deploy → **Manage deployments** → edit → new version, so the URL stays the same.

## What's recorded, and when

- One row when a visitor finishes the questions and submits their name and email (or finishes them while we already
  know their email). Identical answers from the same person on the same day are written once; at most 20 rows a day per person.
- Rental concerns (credit, eviction, etc.) are sensitive. Limit who can open the Sheet, and delete rows you no longer need.
  The Privacy page tells visitors these answers are stored.
- If the Sheet is unreachable, the visitor's flow is not interrupted; the failure is logged in the Netlify function log.
