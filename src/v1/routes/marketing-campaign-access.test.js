const assert = require('node:assert/strict');
const test = require('node:test');
const { allowedTo } = require('../../middleware/allow-route');
const { createMarketingCampaignController } = require('../controllers/marketing-campaign-controller');

function exercise(userType) {
  return new Promise((resolve) => {
    const req = { user: { userType } };
    const res = { error(error, status) { resolve({ nextCalled: false, status, message: error.message }); } };
    allowedTo(['SUPER_ADMIN'])(req, res, () => resolve({ nextCalled: true }));
  });
}

test('marketing campaign routes are SUPER_ADMIN only', async () => {
  assert.deepEqual(await exercise('SUPER_ADMIN'), { nextCalled: true });
  const vendor = await exercise('VENDOR');
  assert.equal(vendor.nextCalled, false);
  assert.equal(vendor.status, 403);
});

test('manual generation controller forwards only the idempotency request identifier', async () => {
  const calls = [];
  const controller = createMarketingCampaignController({
    async generateVendorSpotlights(requestId) {
      calls.push(requestId);
      return [{ action: 'PROCESSING', campaign: { campaignId: 'campaign-new' } }];
    },
  });
  let body;
  await controller.generate(
    { body: { requestId: 'manual-request-1', providerPayload: { secret: true } } },
    { data(value) { body = value; return value; } }
  );
  assert.deepEqual(calls, ['manual-request-1']);
  assert.equal(body.results[0].campaign.campaignId, 'campaign-new');
});
