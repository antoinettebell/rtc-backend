const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MarketingCampaignGateway,
  normalizeTimeoutMs,
} = require('./marketing-campaign-gateway');

function response(data, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return { data }; } };
}

test('uses a bounded regeneration-safe gateway timeout', () => {
  assert.equal(normalizeTimeoutMs(undefined), 60000);
  assert.equal(normalizeTimeoutMs('45000'), 45000);
  assert.equal(normalizeTimeoutMs('999'), 60000);
  assert.equal(normalizeTimeoutMs('120001'), 60000);
  assert.equal(normalizeTimeoutMs('invalid'), 60000);
});

test('uses the internal control API and forwards no admin JWT or provider data', async () => {
  const calls = [];
  const gateway = new MarketingCampaignGateway({
    baseUrl: 'https://marketing.internal', serviceKey: 'service-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ campaigns: [{
        campaignId: 'campaign-1', businessName: 'Vendor', providerPayload: { secret: true },
      }] });
    },
  });
  const campaigns = await gateway.listPendingCampaigns();
  assert.equal(campaigns.length, 1);
  assert.equal('providerPayload' in campaigns[0], false);
  assert.equal(calls[0].url, 'https://marketing.internal/admin/campaigns/pending');
  assert.equal(calls[0].options.headers['x-rtc-service-key'], 'service-secret');
  assert.equal('authorization' in calls[0].options.headers, false);
});

test('projects only safe campaign details', async () => {
  const gateway = new MarketingCampaignGateway({
    baseUrl: 'https://marketing.internal', serviceKey: 'secret',
    fetchImpl: async () => response({ campaign: {
      campaignId: 'campaign-1', businessName: 'Vendor', videoUrl: 'https://video.example/current.mp4',
      selectedFoodImages: [{ name: 'Taco', category: 'Individual', url: 'https://img.example/taco.jpg', prompt: 'secret' }],
      scheduleText: 'THIS WEEK', supportedServices: ['PICKUP'], rawProviderResponse: { secret: true },
      visualVariation: {
        sequence: 2, mode: 'IMAGES_ONLY', animationVariantId: 'ZOOM_FADE', imageRotation: 2,
        providerPayload: { secret: true },
      },
    } }),
  });
  const detail = await gateway.getCampaignDetails('campaign-1');
  assert.equal(detail.selectedFoodImages[0].name, 'Taco');
  assert.deepEqual(detail.visualVariation, {
    sequence: 2, mode: 'IMAGES_ONLY', animationVariantId: 'ZOOM_FADE', imageRotation: 2,
  });
  assert.equal('prompt' in detail.selectedFoodImages[0], false);
  assert.equal('rawProviderResponse' in detail, false);
});

test('sanitizes upstream failures without retaining bodies or credentials', async () => {
  const gateway = new MarketingCampaignGateway({
    baseUrl: 'https://marketing.internal', serviceKey: 'secret',
    fetchImpl: async () => {
      throw Object.assign(new Error('provider payload https://private.example'), { body: { token: 'secret' } });
    },
  });
  await assert.rejects(
    () => gateway.listApprovedCampaigns(),
    (error) => error.code === 'MARKETING_CONTROL_REQUEST_FAILED' &&
      !JSON.stringify(error).includes('private.example')
  );
});

test('regeneration keeps the same campaign identity', async () => {
  const calls = [];
  const gateway = new MarketingCampaignGateway({
    baseUrl: 'https://marketing.internal', serviceKey: 'secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ result: { action: 'PROCESSING', campaign: { campaignId: 'campaign-1' } } });
    },
  });
  const result = await gateway.regenerateCampaign('campaign-1', 'Try a new collage');
  assert.equal(result.campaign.campaignId, 'campaign-1');
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].options.body).reason, 'Try a new collage');
});

test('approval forwards only the authenticated admin identifier', async () => {
  const calls = [];
  const gateway = new MarketingCampaignGateway({
    baseUrl: 'https://marketing.internal', serviceKey: 'secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ campaign: { campaignId: 'campaign-1', approvalStatus: 'APPROVED' } });
    },
  });
  await gateway.approveCampaign('campaign-1', 'admin-1');
  assert.deepEqual(JSON.parse(calls[0].options.body), { approvedBy: 'admin-1' });
});

test('manual generation forwards one idempotency identifier and projects safe results', async () => {
  const calls = [];
  const gateway = new MarketingCampaignGateway({
    baseUrl: 'https://marketing.internal', serviceKey: 'secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ results: [{
        action: 'PROCESSING',
        campaign: { campaignId: 'campaign-new', businessName: 'Vendor', providerPayload: { secret: true } },
      }] });
    },
  });
  const results = await gateway.generateVendorSpotlights(
    'manual-request-1', [
      { vendorId: 'vendor-1', truckUnitIds: ['truck-1'] },
      { vendorId: 'vendor-2', truckUnitIds: ['truck-2'] },
    ],
  );
  assert.equal(results[0].campaign.campaignId, 'campaign-new');
  assert.equal('providerPayload' in results[0].campaign, false);
  assert.equal(calls[0].url, 'https://marketing.internal/admin/campaigns/generate');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    requestId: 'manual-request-1',
    vendorSelections: [
      { vendorId: 'vendor-1', truckUnitIds: ['truck-1'] },
      { vendorId: 'vendor-2', truckUnitIds: ['truck-2'] },
    ],
  });
});

test('eligible vendor listing projects only checkbox-safe fields', async () => {
  const gateway = new MarketingCampaignGateway({
    baseUrl: 'https://marketing.internal', serviceKey: 'secret',
    fetchImpl: async () => response({ vendors: [{
      vendorId: 'vendor-1', businessName: 'Vendor', generationBlocked: false,
      truckUnits: [{ truckUnitId: 'truck-1', name: 'Main Truck', isPrimary: true }],
      providerPayload: { secret: true },
    }] }),
  });
  assert.deepEqual(await gateway.listEligibleVendors(), [{
    vendorId: 'vendor-1', businessName: 'Vendor', generationBlocked: false,
    truckUnits: [{ truckUnitId: 'truck-1', name: 'Main Truck', isPrimary: true }],
  }]);
});
