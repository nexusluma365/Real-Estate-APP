// RentReady Finder's API (Google Places) is maintained in rentready-finder/. Netlify deploys one functions folder,
// so it is re-exported here; public/_redirects rewrites /finder/api/* to it.
import { handler as finderHandler } from '../../rentready-finder/netlify/functions/finder-api.mjs';

// Finder routes on "/finder/api/<route>"; make sure the rewritten function path still reads that way.
export const handler = (event, context) =>
  finderHandler({ ...event, path: (event.path || '').replace(/^\/\.netlify\/functions\/finder-api/, '/finder/api') }, context);
