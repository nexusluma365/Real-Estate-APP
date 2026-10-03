const assert = require('assert');

const { classifySources } = require('../netlify/functions/_lib/screening-verification');

function run() {
  const property = {
    propertyId: 'place_123',
    name: 'Example Apartments',
    website: 'https://exampleapartments.com',
  };

  const thirdParty = classifySources([
    {
      url: 'https://thirdparty-directory.test/example-apartments',
      content: 'Example Apartments is listed as a second chance apartment by this directory.',
    },
  ], property);
  assert.equal(thirdParty.status, 'unverified');

  const ambiguous = classifySources([
    {
      url: 'https://exampleapartments.com/criteria',
      content: 'Applicants are reviewed according to our resident selection criteria.',
    },
  ], property);
  assert.equal(ambiguous.status, 'unverified');

  const flexible = classifySources([
    {
      url: 'https://exampleapartments.com/rental-criteria',
      content: 'Some applicants may receive conditional approval with an additional deposit or guarantor.',
    },
  ], property);
  assert.equal(flexible.status, 'flexible_screening');
  assert.match(flexible.evidence_summary, /conditional approval|additional deposit/i);

  const verified = classifySources([
    {
      url: 'https://exampleapartments.com/second-chance',
      content: 'Our second chance program may allow applicants with prior eviction or broken lease history to qualify under defined conditions.',
    },
  ], property);
  assert.equal(verified.status, 'verified_second_chance');
  assert.match(verified.evidence_summary, /second chance/i);

  const officialFlag = classifySources([
    {
      url: 'https://cdn-host.test/policy',
      firstParty: true,
      content: 'This property has a second-chance program for renters with prior adverse rental history.',
    },
  ], property);
  assert.equal(officialFlag.status, 'verified_second_chance');
}

run();
console.log('screening verification test passed');
