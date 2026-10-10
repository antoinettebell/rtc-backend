const SAFE_CAMPAIGN_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
const SAFE_REASON = /^[\p{L}\p{N} .,_'-]{0,500}$/u;
const SOCIAL_CONTENT_BRANDS = new Set(['RTC', 'SBE']);
const SOCIAL_CONTENT_CREATIVE_FORMATS = new Set(['IMAGE_POST', 'CAROUSEL', 'SHORT_VIDEO']);
const DEFAULT_TIMEOUT_MS = 60000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120000;

const normalizeTimeoutMs = (value) => {
  if (value === undefined || value === null || value === '') return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= MIN_TIMEOUT_MS && parsed <= MAX_TIMEOUT_MS
    ? parsed
    : DEFAULT_TIMEOUT_MS;
};

// Existing Admin traffic targets the Creative Engine under /api/marketing-control.
// SMA is a sibling route on the same Azure Function host under /api/sma.
const socialMediaBaseUrl = (baseUrl) => String(baseUrl || '').replace(/\/marketing-control$/, '');

class MarketingCampaignGatewayError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = 'MarketingCampaignGatewayError';
    this.code = code;
    this.status = status;
  }
}

const requireCampaignId = (value) => {
  if (typeof value !== 'string' || !SAFE_CAMPAIGN_ID.test(value)) {
    throw new MarketingCampaignGatewayError('INVALID_CAMPAIGN_ID', 400);
  }
  return value;
};

const requireSocialContentFormat = (value) => {
  if (typeof value !== 'string' || !SOCIAL_CONTENT_CREATIVE_FORMATS.has(value)) {
    throw new MarketingCampaignGatewayError('INVALID_SOCIAL_CONTENT_FORMAT', 400);
  }
  return value;
};

const requireAppFeatureSelections = (values) => {
  if (!Array.isArray(values) || values.length < 1 || values.length > 100) {
    throw new MarketingCampaignGatewayError('INVALID_CAMPAIGN_SELECTION', 400);
  }
  const seen = new Set();
  return values.map((value) => {
    const featureKey = requireCampaignId(String(value?.featureKey || ''));
    const creativeMode = String(value?.creativeMode || 'STANDARD_FEATURE');
    if (!['STANDARD_FEATURE', 'SCENARIO_TALKING'].includes(creativeMode) || seen.has(`${featureKey}:${creativeMode}`)) {
      throw new MarketingCampaignGatewayError('INVALID_CAMPAIGN_SELECTION', 400);
    }
    seen.add(`${featureKey}:${creativeMode}`);
    return { featureKey, creativeMode };
  });
};

const safeGenerationFailure = (value) => {
  const code = typeof value?.code === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(value.code)
    ? value.code : null;
  const stage = typeof value?.stage === 'string' && /^[A-Za-z][A-Za-z0-9 -]{0,49}$/.test(value.stage)
    ? value.stage : null;
  return code ? { code, stage } : null;
};

// The SMA Function already emits a deliberately allowlisted, safe error code.
// Preserve only those codes for the Admin review surface; every other upstream
// response stays behind the existing generic gateway failure boundary.
const safeSmaFailureCode = (value) => {
  const code = value?.data?.error?.code ?? value?.body?.data?.error?.code ?? value?.error?.code;
  return typeof code === 'string' && /^(?:SMA|OPENAI)_[A-Z0-9_]{1,94}$/.test(code) ? code : null;
};

// The Marketing Function's Growth Engine controller emits safe categories.
// Preserve only those categories through the internal gateway so Admin can
// report a failed request without receiving messages, provider bodies, or
// credentials.
const SAFE_GROWTH_FAILURE_CODE = /^(?:APP_FEATURE|CAMPAIGN|COMPOSITION|CONFIGURATION|CREATOMATE|EVENT|FAL|FORBIDDEN|INELIGIBLE|INVALID|MUSIC|NO_EVENT|OPENAI|OUTPUT|PROMPT|RENDER|REQUEST|SCENE|SCENARIO|SCHEDULE)_[A-Z0-9_]{1,94}$|^GENERATION_FAILED$/;
const safeGrowthFailureCode = (value) => {
  const code = value?.data?.error?.code ?? value?.body?.data?.error?.code ?? value?.error?.code;
  return typeof code === 'string' && SAFE_GROWTH_FAILURE_CODE.test(code) ? code : null;
};

const campaignListItem = (value = {}) => ({
  campaignId: value.campaignId ?? null,
  vendorId: value.vendorId ?? null,
  businessName: value.businessName ?? null,
  campaignType: value.campaignType ?? null,
  creativeMode: value.creativeMode ?? null,
  reason: value.reason ?? null,
  createdAt: value.createdAt ?? null,
  generatedAt: value.generatedAt ?? value.updatedAt ?? null,
  updatedAt: value.updatedAt ?? null,
  approvedAt: value.approvedAt ?? null,
  videoUrl: value.videoUrl ?? null,
  approvalStatus: value.approvalStatus ?? null,
  generationStatus: value.generationStatus ?? null,
  regenerationStatus: value.regenerationStatus ?? null,
  regenerationFailure: safeGenerationFailure(value.regenerationFailure),
  nextRetryAt: value.nextRetryAt ?? null,
  regenerationCount: Number(value.regenerationCount) || 0,
});

const campaignDetail = (value = {}) => ({
  ...campaignListItem(value),
  archivedAt: value.archivedAt ?? null,
  campaignMonth: value.campaignMonth ?? null,
  campaignVersion: Number(value.campaignVersion) || 0,
  selectedFoodImages: Array.isArray(value.selectedFoodImages)
    ? value.selectedFoodImages.map((image) => ({
      name: image?.name ?? null,
      category: image?.category ?? null,
      url: image?.url ?? null,
    }))
    : [],
  scheduleText: value.scheduleText ?? null,
  supportedServices: Array.isArray(value.supportedServices)
    ? value.supportedServices.filter((service) => typeof service === 'string')
    : [],
  visualVariation: value.visualVariation ? {
    sequence: Number(value.visualVariation.sequence) || 0,
    mode: value.visualVariation.mode ?? 'BASELINE',
    animationVariantId: value.visualVariation.animationVariantId ?? 'STATIC_STACK',
    imageRotation: Number(value.visualVariation.imageRotation) || 0,
  } : null,
  scenarioTalking: value.creativeMode === 'SCENARIO_TALKING' ? {
    dialogue: value.scenarioTalking?.dialogue ?? null,
    templateId: value.scenarioTalking?.templateId ?? null,
    screenshotKey: value.scenarioTalking?.screenshotKey ?? null,
    media: value.scenarioTalking?.media ?? null,
  } : null,
});

const eligibleVendor = (value = {}) => ({
  vendorId: value.vendorId ?? null,
  businessName: value.businessName ?? null,
  truckUnits: Array.isArray(value.truckUnits) ? value.truckUnits.map((unit) => ({
    truckUnitId: unit?.truckUnitId ?? null,
    name: unit?.name ?? null,
    isPrimary: unit?.isPrimary === true,
  })).filter((unit) => unit.truckUnitId && unit.name) : [],
  generationBlocked: value.generationBlocked === true,
});

const eligibleAppFeature = (value = {}) => ({
  featureKey: value.featureKey ?? null,
  featureName: value.featureName ?? null,
  audience: value.audience ?? null,
  creativeModes: Array.isArray(value.creativeModes)
    ? value.creativeModes.filter((mode) => ['STANDARD_FEATURE', 'SCENARIO_TALKING'].includes(mode))
    : ['STANDARD_FEATURE'],
  generationBlocked: value.generationBlocked === true,
});

const eligibleEvent = (value = {}) => ({
  eventId: value.eventId ?? null,
  eventName: value.eventName ?? null,
  eventDate: value.eventDate ?? null,
  city: value.city ?? null,
  state: value.state ?? null,
  ticketMode: value.ticketMode ?? null,
  imageMode: value.imageMode ?? null,
  generationBlocked: value.generationBlocked === true,
});

const requireVendorIds = (values) => {
  if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
    throw new MarketingCampaignGatewayError('INVALID_VENDOR_SELECTION', 400);
  }
  const ids = [...new Set(values.map(requireCampaignId))];
  if (ids.length === 0) throw new MarketingCampaignGatewayError('INVALID_VENDOR_SELECTION', 400);
  return ids;
};

const requireVendorSelections = (values) => {
  if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
    throw new MarketingCampaignGatewayError('INVALID_VENDOR_SELECTION', 400);
  }
  const seen = new Set();
  return values.map((selection) => {
    const vendorId = requireCampaignId(selection?.vendorId);
    if (seen.has(vendorId)) {
      throw new MarketingCampaignGatewayError('INVALID_VENDOR_SELECTION', 400);
    }
    seen.add(vendorId);
    const truckUnitIds = requireVendorIds(selection?.truckUnitIds);
    return { vendorId, truckUnitIds };
  });
};

const cleanReason = (value) => {
  if (typeof value !== 'string') return '';
  const reason = value.trim().slice(0, 500);
  if (!SAFE_REASON.test(reason)) {
    throw new MarketingCampaignGatewayError('INVALID_REGENERATION_REASON', 400);
  }
  return reason;
};

const requireSocialContentBrand = (value) => {
  const brandCode = String(value || '').trim().toUpperCase();
  if (!SOCIAL_CONTENT_BRANDS.has(brandCode)) {
    throw new MarketingCampaignGatewayError('SMA_UNKNOWN_BRAND', 400);
  }
  return brandCode;
};

class MarketingCampaignGateway {
  constructor({
    baseUrl = process.env.MARKETING_CONTROL_API_URL,
    serviceKey = process.env.MARKETING_CONTROL_API_KEY,
    fetchImpl = globalThis.fetch,
    timeoutMs = process.env.MARKETING_CONTROL_TIMEOUT_MS,
  } = {}) {
    this.baseUrl = String(baseUrl || '').trim().replace(/\/+$/, '');
    this.serviceKey = String(serviceKey || '').trim();
    this.fetchImpl = fetchImpl;
    this.timeoutMs = normalizeTimeoutMs(timeoutMs);
  }

  async request(path, { method = 'GET', body, baseUrl = this.baseUrl } = {}) {
    if (!baseUrl || !this.serviceKey || typeof this.fetchImpl !== 'function') {
      throw new MarketingCampaignGatewayError('MARKETING_CONTROL_UNAVAILABLE', 503);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-rtc-service-key': this.serviceKey,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const code = safeSmaFailureCode(payload) ?? safeGrowthFailureCode(payload);
        if (code) throw new MarketingCampaignGatewayError(code, response.status);
        throw new MarketingCampaignGatewayError(
          response.status === 404 ? 'CAMPAIGN_NOT_FOUND' : 'MARKETING_CONTROL_REQUEST_FAILED',
          response.status === 404 ? 404 : 502
        );
      }
      const payload = await response.json();
      return payload?.data ?? payload?.body?.data ?? payload;
    } catch (error) {
      if (error instanceof MarketingCampaignGatewayError) throw error;
      throw new MarketingCampaignGatewayError('MARKETING_CONTROL_REQUEST_FAILED', 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  async listPendingCampaigns() {
    const data = await this.request('/admin/campaigns/pending');
    return (Array.isArray(data?.campaigns) ? data.campaigns : []).map(campaignListItem);
  }

  async listApprovedCampaigns() {
    const data = await this.request('/admin/campaigns/approved');
    return (Array.isArray(data?.campaigns) ? data.campaigns : []).map(campaignListItem);
  }

  async listEligibleVendors() {
    const data = await this.request('/admin/vendors/eligible');
    return (Array.isArray(data?.vendors) ? data.vendors : []).map(eligibleVendor);
  }

  async listEligibleAppFeatures() {
    const data = await this.request('/admin/app-features/eligible');
    return (Array.isArray(data?.features) ? data.features : []).map(eligibleAppFeature);
  }

  async listEligibleEvents() {
    const data = await this.request('/admin/events/eligible');
    return (Array.isArray(data?.events) ? data.events : []).map(eligibleEvent);
  }

  async generateVendorSpotlights(requestId, vendorSelections) {
    const data = await this.request('/admin/campaigns/generate', {
      method: 'POST', body: {
        requestId: requireCampaignId(requestId),
        vendorSelections: requireVendorSelections(vendorSelections),
      },
    });
    return (Array.isArray(data?.results) ? data.results : []).map((result) => ({
      action: result?.action ?? null,
      campaign: result?.campaign ? campaignListItem(result.campaign) : null,
    }));
  }

  async generateAppFeatures(requestId, featureSelections) {
    const data = await this.request('/admin/campaigns/generate-app-features', {
      method: 'POST', body: {
        requestId: requireCampaignId(requestId),
        featureSelections: requireAppFeatureSelections(featureSelections),
      },
    });
    return (Array.isArray(data?.results) ? data.results : []).map((result) => ({
      action: result?.action ?? null,
      campaign: result?.campaign ? campaignListItem(result.campaign) : null,
    }));
  }

  async generateEvents(requestId, eventIds) {
    const data = await this.request('/admin/campaigns/generate-events', {
      method: 'POST', body: {
        requestId: requireCampaignId(requestId),
        eventIds: requireVendorIds(eventIds),
      },
    });
    return (Array.isArray(data?.results) ? data.results : []).map((result) => ({
      action: result?.action ?? null,
      campaign: result?.campaign ? campaignListItem(result.campaign) : null,
    }));
  }

  async getCampaignDetails(campaignId) {
    const id = requireCampaignId(campaignId);
    const data = await this.request(`/admin/campaigns/${encodeURIComponent(id)}`);
    return campaignDetail(data?.campaign);
  }

  async approveCampaign(campaignId, approvedBy) {
    const id = requireCampaignId(campaignId);
    const data = await this.request(`/admin/campaigns/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: { approvedBy: requireCampaignId(String(approvedBy || '')) },
    });
    return campaignListItem(data?.campaign);
  }

  async discardCampaign(campaignId) {
    const id = requireCampaignId(campaignId);
    const data = await this.request(`/admin/campaigns/${encodeURIComponent(id)}/discard`, {
      method: 'POST',
    });
    return campaignListItem(data?.campaign);
  }

  async regenerateCampaign(campaignId, reason) {
    const id = requireCampaignId(campaignId);
    const data = await this.request(`/admin/campaigns/${encodeURIComponent(id)}/regenerate`, {
      method: 'POST', body: { reason: cleanReason(reason) },
    });
    return {
      action: data?.result?.action ?? data?.action ?? null,
      campaignId: data?.result?.campaignId ?? id,
      jobId: data?.result?.jobId ?? null,
      status: data?.result?.status ?? null,
    };
  }

  async listSocialContent({ brandCode, lifecycleStatus } = {}) {
    const query = new URLSearchParams();
    if (brandCode) query.set('brand', requireSocialContentBrand(brandCode));
    if (lifecycleStatus) query.set('status', String(lifecycleStatus).trim().slice(0, 80));
    const suffix = query.size ? `?${query.toString()}` : '';
    const data = await this.request(`/sma/content${suffix}`, { baseUrl: socialMediaBaseUrl(this.baseUrl) });
    return Array.isArray(data?.content) ? data.content : [];
  }

  async requestSocialContentDecision(brandCode, format) {
    const data = await this.request('/sma/content/request-decision', {
      method: 'POST', body: { brandCode: requireSocialContentBrand(brandCode), format: requireSocialContentFormat(format) }, baseUrl: socialMediaBaseUrl(this.baseUrl),
    });
    return data?.content ?? null;
  }

  async completeSocialContentVerification(contentId) {
    const id = requireCampaignId(contentId);
    const data = await this.request(`/sma/content/${encodeURIComponent(id)}/verification-complete`, { method: 'POST', baseUrl: socialMediaBaseUrl(this.baseUrl) });
    return data?.content ?? null;
  }

  async getSocialContent(contentId) {
    const id = requireCampaignId(contentId);
    const data = await this.request(`/sma/content/${encodeURIComponent(id)}`, { baseUrl: socialMediaBaseUrl(this.baseUrl) });
    return data?.content ?? null;
  }

  async generateSocialContentCreative(contentId) {
    const id = requireCampaignId(contentId);
    const data = await this.request(`/sma/content/${encodeURIComponent(id)}/creative/generate`, {
      method: 'POST', baseUrl: socialMediaBaseUrl(this.baseUrl),
    });
    return data?.content ?? null;
  }

  async regenerateSocialContentCreative(contentId) {
    const id = requireCampaignId(contentId);
    const data = await this.request(`/sma/content/${encodeURIComponent(id)}/creative/retry`, {
      method: 'POST', body: { confirmed: true }, baseUrl: socialMediaBaseUrl(this.baseUrl),
    });
    return data?.content ?? null;
  }

  async getSocialContentCreativePreview(contentId) {
    const id = requireCampaignId(contentId);
    const data = await this.request(`/sma/content/${encodeURIComponent(id)}/creative/preview`, { baseUrl: socialMediaBaseUrl(this.baseUrl) });
    const previewUrls = (Array.isArray(data?.previewUrls) ? data.previewUrls : [data?.previewUrl])
      .filter((value) => typeof value === 'string' && value);
    return { previewUrl: previewUrls[0] ?? null, previewUrls };
  }

  async approveSocialContent(contentId, approvedBy) {
    const id = requireCampaignId(contentId);
    const data = await this.request(`/sma/content/${encodeURIComponent(id)}/approve`, {
      method: 'POST', body: { approvedBy: requireCampaignId(String(approvedBy || '')) }, baseUrl: socialMediaBaseUrl(this.baseUrl),
    });
    return data?.content ?? null;
  }

  async rejectSocialContent(contentId, rejectedBy) {
    const id = requireCampaignId(contentId);
    const data = await this.request(`/sma/content/${encodeURIComponent(id)}/reject`, {
      method: 'POST', body: { rejectedBy: requireCampaignId(String(rejectedBy || '')) }, baseUrl: socialMediaBaseUrl(this.baseUrl),
    });
    return data?.content ?? null;
  }
}

module.exports = {
  MarketingCampaignGateway,
  MarketingCampaignGatewayError,
  normalizeTimeoutMs,
  socialMediaBaseUrl,
  campaignListItem,
  campaignDetail,
  eligibleVendor,
  eligibleAppFeature,
  eligibleEvent,
};
