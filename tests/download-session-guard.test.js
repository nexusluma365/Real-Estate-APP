const assert = require('assert');
const { withSession } = require('./_session-helper');
const { sign } = require('../netlify/functions/_lib/sign');

function loadHandler(fnName) {
  const storePath = require.resolve('../netlify/functions/_lib/store');
  const fnPath = require.resolve(`../netlify/functions/${fnName}`);
  delete require.cache[fnPath];
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      getEntitlements: async () => ({ paid10: true, paid27: true }),
      getProtectedFile: async () => null,
      getLead: async () => null,
    },
  };
  return require(fnPath).handler;
}

async function run() {
  // A bare leadId (no session, no signed token) must not unlock paid files
  // or the renter's personal results PDF.
  const downloadFile = loadHandler('download-file');
  const bare = await downloadFile({ httpMethod: 'GET', queryStringParameters: { leadId: 'lead_victim', product: 'gameplan' } });
  assert.equal(bare.statusCode, 401);

  const otherLead = await downloadFile(withSession({ httpMethod: 'GET', queryStringParameters: { leadId: 'lead_victim', product: 'gameplan' } }, 'lead_attacker', 'lead'));
  assert.equal(otherLead.statusCode, 401);

  // The owner's session passes the guard (404 = entitled, file not uploaded).
  const owner = await downloadFile(withSession({ httpMethod: 'GET', queryStringParameters: { leadId: 'lead_victim', product: 'gameplan' } }, 'lead_victim', 'lead'));
  assert.equal(owner.statusCode, 404);

  // Signed email links keep working without a session.
  const token = sign({ leadId: 'lead_victim', product: 'gameplan' }, 60 * 1000);
  const viaToken = await downloadFile({ httpMethod: 'GET', queryStringParameters: { token } });
  assert.equal(viaToken.statusCode, 404);

  const resultPdf = loadHandler('download-result-pdf');
  const barePdf = await resultPdf({ httpMethod: 'GET', queryStringParameters: { leadId: 'lead_victim' } });
  assert.equal(barePdf.statusCode, 401);
}

run()
  .then(() => console.log('download session guard test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
