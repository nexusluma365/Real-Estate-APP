# RentReady Finder

Standalone apartment-discovery app for **werentreadygo.com/finder**. Independent of the existing RentReady site — it imports nothing from it.

**Status: Phase A complete (responsive visual frontend).** No live data integrations yet — by design.

## Run

```bash
npm install
npm run dev            # http://localhost:5173/finder/
npm run build          # type-check + production build to dist/ (base path /finder/)
npm run build:single   # one self-contained HTML file in dist-single/ (design review)
```

## Stack
React 18 · TypeScript · Tailwind CSS 3 · Motion · React Router 6 · Vite 5

## Structure
```
src/
  App.tsx                     router (/ , /property/:placeId), error boundary, reduced-motion config
  context/FinderContext.tsx   shared filters, second-chance mode, section navigation
  services/api.ts             server API client — Phase A stubs that reject with ServiceNotConnectedError
  types/property.ts           Property, PropertyPhoto, SearchFilters, LocationSuggestion
  types/policy.ts             PolicyStatus, PolicyClaim (evidence record w/ expiry), POLICY_LEVELS copy
  config/media.ts             editorial photography (Unsplash License) — swap for owned photos
  components/ui/              Button, Field (inputs/select), Loader (3D navy/gold), Skeleton, SmartImage, Reveal, Icons
  components/layout/          Navbar (transparent → navy on scroll, mobile menu), Footer, Logo, ErrorBoundary
  components/home/            Hero, FeatureCards, AboutSection, FeaturedSection, SearchSection,
                              LocationCombobox (ARIA combobox, debounced, cancellable), SecondChancePanel, HowItWorks
  components/property/        PropertyCard (live data only), PreviewCard (labelled layout preview), PolicyBadge
  pages/                      HomePage, PropertyDetailsPage (skeleton + live layout)
```

## Honesty rules already enforced in the UI
- No sample/mock properties are ever rendered as listings. Featured cards are visibly labelled **"Layout preview · Not a listing"** until Phase C.
- Searches validate the location, show the loader, then state plainly that live search isn't connected.
- Pricing shows "Contact for current pricing." unless an authorized source supplies it; availability is "Unconfirmed".
- Policy badge defaults to "Rental policy not confirmed"; "Verified" requires a stored `PolicyClaim`.
- Rent/bed/bath filters explain that Google Places doesn't provide that data and that properties are never silently hidden.
- Geolocation is requested only when "Use My Location" is pressed.

## Next: Phase B
Netlify Functions for autocomplete, geocoding, Text/Nearby Search with field masks, and a photo proxy — keys from `.env` (see `.env.example`), never shipped to the browser.


## Phase B update — Live Google Places backend

A Netlify Function now implements autocomplete, apartment searches, featured properties, property details and photo redirects. **No live results can be tested until a valid Google Places API (New) key is configured.** Set `GOOGLE_MAPS_API_KEY` in Netlify environment variables; enable Places API (New) and billing. Deploy at `/finder/` with the included `netlify.toml` routing. Test via Netlify Dev (`npx netlify dev`) rather than Vite alone, because Vite does not serve Netlify Functions.

**Important:** Google Places returns apartment communities, not verified available units, prices or second-chance eligibility. The second-chance-only filter correctly returns no verified results until evidence-backed policy records are implemented. AI enrichment is not connected. Google photo use requires appropriate attribution and compliance with Google Maps Platform policies.
