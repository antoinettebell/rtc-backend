const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MarketingCampaignGateway,
  normalizeTimeoutMs,
  socialMediaBaseUrl,
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

test('derives the sibling SMA Azure route from the existing Creative Engine base URL', () => {
  assert.equal(
    socialMediaBaseUrl('https://function.example/api/marketing-control'),
    'https://function.example/api',
  );
});

test('uses the SMA endpoint on the existing Azure Function host and forwards no admin JWT', async () => {
  const calls = [];
  const gateway = new MarketingCampaignGateway({
    baseUrl: 'https://function.example/api/marketing-control', serviceKey: 'service-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ content: [{ contentId: 'sma-content-123', lifecycleStatus: 'READY_FOR_APPROVAL' }] });
    },
  });
  const content = await gateway.listSocialContent({ brandCode: 'RTC' });
  assert.equal(content[0].contentId, 'sma-content-123');
  assert.equal(calls[0].url, 'https://function.example/api/sma/content?brand=RTC');
  assert.equal(calls[0].options.headers['x-rtc-service-key'], 'service-secret');
  assert.equal('authorization' in calls[0].options.headers, false);
});

test('uses SMA-only final-creative endpoints and never forwards provider data', async () => {
  const calls = [];
  const gateway = new MarketingCampaignGateway({
    baseUrl: 'https://function.example/api/marketing-control', serviceKey: 'service-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(options.method === 'POST'
        ? { content: { contentId: 'sma-content-123', creativeProduction: { status: 'QUEUED' } } }
        : { previewUrl: 'https://temporary.example/final.png', previewUrls: ['https://temporary.example/final.png', 'https://temporary.example/final-2.png', 'https://temporary.example/final-3.png'] });
    },
  });
  await gateway.regenerateSocialContentCreative('sma-content-123');
  assert.equal(calls[0].url, 'https://function.example/api/sma/content/sma-content-123/creative/retry');
  assert.deepEqual(JSON.parse(calls[0].options.body), { confirmed: true });
  assert.equal('authorization' in calls[0].options.headers, false);
  assert.deepEqual(await gateway.getSocialContentCreativePreview('sma-content-123'), {
    previewUrl: 'https://temporary.example/final.png',
    previewUrls: ['https://temporary.example/final.png', 'https://temporary.example/final-2.png', 'https://temporary.example/final-3.png'],
  });
  assert.equal(calls[1].url, 'https://function.example/api/sma/content/sma-content-123/creative/preview');
});

test('uses the internal control API and forwards no admin JWT or provider data', async () => {
  const calls = [];
  const gateway = new MarketingCampaignGateway({
    baseUrl: 'https://marketing.internal', serviceKey: 'service-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ campaigns: [{
        campaignId: 'campaign-1', businessName: 'Vendor', providerPayload: { secret: true },
        regenerationStatus: 'RETRY_SCHEDULED', nextRetryAt: '2026-10-04T12:00:00.000Z',
        regenerationFailure: { code: 'OPENAI_RATE_LIMITED', stage: 'generation', rawBody: 'secret' },
      }] });
    },
  });
  const campaigns = await gateway.listPendingCampaigns();
  assert.equal(campaigns.length, 1);
  assert.equal('providerPayload' in campaigns[0], false);
  assert.deepEqual(campaigns[0].regenerationFailure, {
    code: 'OPENAI_RATE_LIMITED', stage: 'generation',
  });
  assert.equal(campaigns[0].nextRetryAt, '2026-10-04T12:00:00.000Z');
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

test('preserves the APP_FEATURE Scenario Talking discriminator and approved review metadata', async () => {
  const gateway = new MarketingCampaignGateway({
    baseUrl: 'https://marketing.internal', serviceKey: 'secret',
    fetchImpl: async () => response({ campaign: {
      campaignId: 'scenario-talking-12345678', campaignType: 'APP_FEATURE', creativeMode: 'SCENARIO_TALKING',
      scenarioTalking: { dialogue: { operator: 'Payments, staff, schedules—too many apps!', guide: 'Run your truck with Round Da’ Corner.' }, templateId: 'template-1', screenshotKey: 'approved.png', media: { operator: { videoKey: 'private.mp4' } }, providerPayload: { secret: true } },
    } }),
  });
  const detail = await gateway.getCampaignDetails('scenario-talking-12345678');
  assert.equal(detail.campaignType, 'APP_FEATURE');
  assert.equal(detail.creativeMode, 'SCENARIO_TALKING');
  assert.equal(detail.scenarioTalking.dialogue.guide, 'Run your truck with Round Da’ Corner.');
  assert.equal('providerPayload' in detail.scenarioTalking, false);
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

test('preserves only allowlisted safe SMA errors and their upstream status', async () => {
  const gateway = new MarketingCampaignGateway({
    baseUrl: 'https://function.example/api/marketing-control', serviceKey: 'secret',
    fetchImpl: async () => response({ error: { code: 'SMA_AUDIENCE_OBJECTIVE_MISMATCH', providerBody: 'never expose' } }, { ok: false, status: 400 }),
  });
  await assert.rejects(
    () => gateway.requestSocialContentDecision('RTC'),
    (error) => error.code === 'SMA_AUDIENCE_OBJECTIVE_MISMATCH' && error.status === 400 &&
      !JSON.stringify(error).includes('providerBody')
  );
});

test('keeps arbitrary upstream failure payloads behind the generic gateway boundary', async () => {
  const gateway = new MarketingCampaignGateway({
    baseUrl: 'https://function.example/api/marketing-control', serviceKey: 'secret',
    fetchImpl: async () => response({ error: { code: 'UNTRUSTED_PROVIDER_FAILURE', message: 'private detail' } }, { ok: false, status: 500 }),
  });
  await assert.rejects(
    () => gateway.requestSocialContentDecision('RTC'),
    (error) => error.code === 'MARKETING_CONTROL_REQUEST_FAILED' && error.status === 502 &&
      !JSON.stringify(error).includes('UNTRUSTED_PROVIDER_FAILURE')
  );
});

test('regeneration returns the queued job identity and status', async () => {
  const calls = [];
  const gateway = new MarketingCampaignGateway({
    baseUrl: 'https://marketing.internal', serviceKey: 'secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ result: {
        action: 'QUEUED', campaignId: 'campaign-1', jobId: 'job-1', status: 'QUEUED',
      } });
    },
  });
  const result = await gateway.regenerateCampaign('campaign-1', 'Try a new collage');
  assert.deepEqual(result, {
    action: 'QUEUED', campaignId: 'campaign-1', jobId: 'job-1', status: 'QUEUED',
  });
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].options.body).reason, 'Try a new collage');
});

test('forwards categorized app feature and public event initial generation', async () => {
  const calls = [];
  const gateway = new MarketingCampaignGateway({
    baseUrl: 'https://marketing.internal', serviceKey: 'secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ results: [{
        action: 'QUEUED', campaign: {
          campaignId: url.includes('app-features') ? 'feature-1' : 'event-1',
          campaignType: url.includes('app-features') ? 'APP_FEATURE' : 'EVENT_PROMOTION',
          regenerationStatus: 'QUEUED',
        },
      }] });
    },
  });
  const features = await gateway.generateAppFeatures('request-1', ['customer-feature']);
  const events = await gateway.generateEvents('request-2', ['event-123']);
  assert.equal(features[0].campaign.regenerationStatus, 'QUEUED');
  assert.equal(events[0].campaign.campaignType, 'EVENT_PROMOTION');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    requestId: 'request-1', featureKeys: ['customer-feature'],
  });
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    requestId: 'request-2', eventIds: ['event-123'],
  });
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

test('discard removes only the selected pending campaign through the control API', async () => {
  const calls = [];
  const gateway = new MarketingCampaignGateway({
    baseUrl: 'https://marketing.internal', serviceKey: 'secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ campaign: { campaignId: 'campaign-1', approvalStatus: 'PENDING_APPROVAL' } });
    },
  });
  const campaign = await gateway.discardCampaign('campaign-1');
  assert.equal(campaign.campaignId, 'campaign-1');
  assert.equal(calls[0].url, 'https://marketing.internal/admin/campaigns/campaign-1/discard');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body, undefined);
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

test('eligible app feature and event listings expose only selection-safe fields', async () => {
  const gateway = new MarketingCampaignGateway({
    baseUrl: 'https://marketing.internal', serviceKey: 'secret',
    fetchImpl: async (url) => url.includes('app-features')
      ? response({ features: [{
        featureKey: 'customer-feature', featureName: 'Feature', audience: 'CUSTOMER',
        generationBlocked: false, approvedFacts: ['private-to-gateway'],
      }] })
      : response({ events: [{
        eventId: 'event-1', eventName: 'Public Event', eventDate: '2026-10-20',
        city: 'Columbia', state: 'SC', ticketMode: 'NON_TICKETED',
        imageMode: 'EVENT_DETAILS_MODE', generationBlocked: false,
        sourceEvent: { private: true },
      }] }),
  });
  assert.deepEqual(await gateway.listEligibleAppFeatures(), [{
    featureKey: 'customer-feature', featureName: 'Feature', audience: 'CUSTOMER', generationBlocked: false,
  }]);
  assert.deepEqual(await gateway.listEligibleEvents(), [{
    eventId: 'event-1', eventName: 'Public Event', eventDate: '2026-10-20', city: 'Columbia',
    state: 'SC', ticketMode: 'NON_TICKETED', imageMode: 'EVENT_DETAILS_MODE', generationBlocked: false,
  }]);
});
