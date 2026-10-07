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

test('manual generation controller forwards only the request identifier and selected vendors', async () => {
  const calls = [];
  const controller = createMarketingCampaignController({
    async generateVendorSpotlights(requestId, vendorSelections) {
      calls.push([requestId, vendorSelections]);
      return [{ action: 'PROCESSING', campaign: { campaignId: 'campaign-new' } }];
    },
  });
  let body;
  await controller.generate(
    {
      body: {
        requestId: 'manual-request-1',
        vendorSelections: [{ vendorId: 'vendor-1', truckUnitIds: ['truck-1'] }],
        providerPayload: { secret: true },
      },
    },
    { data(value) { body = value; return value; } }
  );
  assert.deepEqual(calls, [['manual-request-1', [
    { vendorId: 'vendor-1', truckUnitIds: ['truck-1'] },
  ]]]);
  assert.equal(body.results[0].campaign.campaignId, 'campaign-new');
});

test('eligible-vendor controller returns only the gateway vendor list', async () => {
  const controller = createMarketingCampaignController({
    async listEligibleVendors() {
      return [{ vendorId: 'vendor-1', businessName: 'Vendor', generationBlocked: false }];
    },
  });
  let body;
  await controller.listEligibleVendors({}, {
    data(value) { body = value; return value; },
  });
  assert.deepEqual(body, { vendors: [{
    vendorId: 'vendor-1', businessName: 'Vendor', generationBlocked: false,
  }] });
});

test('initial campaign controllers forward only identifiers and selections', async () => {
  const calls = [];
  const controller = createMarketingCampaignController({
    async generateAppFeatures(requestId, keys) { calls.push(['features', requestId, keys]); return []; },
    async generateEvents(requestId, ids) { calls.push(['events', requestId, ids]); return []; },
  });
  const res = { data(value) { return value; } };
  await controller.generateAppFeatures({
    body: { requestId: 'request-1', featureKeys: ['feature-1'], ignored: 'private' },
  }, res);
  await controller.generateEvents({
    body: { requestId: 'request-2', eventIds: ['event-1'], ignored: 'private' },
  }, res);
  assert.deepEqual(calls, [
    ['features', 'request-1', ['feature-1']],
    ['events', 'request-2', ['event-1']],
  ]);
});

test('discard controller forwards only the selected campaign identifier', async () => {
  const calls = [];
  const controller = createMarketingCampaignController({
    async discardCampaign(campaignId) {
      calls.push(campaignId);
      return { campaignId, approvalStatus: 'PENDING_APPROVAL' };
    },
  });
  let body;
  await controller.discard({ params: { campaignId: 'campaign-1' } }, {
    data(value) { body = value; return value; },
  });
  assert.deepEqual(calls, ['campaign-1']);
  assert.equal(body.campaign.campaignId, 'campaign-1');
});

test('social content controller forwards only the requested brand and authenticated reviewer', async () => {
  const calls = [];
  const controller = createMarketingCampaignController({
    async requestSocialContentDecision(brandCode) {
      calls.push(['request', brandCode]);
      return { contentId: 'sma-content-123', lifecycleStatus: 'READY_FOR_APPROVAL' };
    },
    async approveSocialContent(contentId, approvedBy) {
      calls.push(['approve', contentId, approvedBy]);
      return { contentId, lifecycleStatus: 'APPROVED' };
    },
  });
  let created;
  const createdResponse = {
    status(value) { created = value; return this; },
    data(value) { return value; },
  };
  await controller.requestSocialContentDecision({ body: { brandCode: 'RTC', ignored: 'private' } }, createdResponse);
  await controller.approveSocialContent({ params: { contentId: 'sma-content-123' }, user: { _id: 'admin-1' } }, { data(value) { return value; } });
  assert.equal(created, 202);
  assert.deepEqual(calls, [
    ['request', 'RTC'],
    ['approve', 'sma-content-123', 'admin-1'],
  ]);
});
