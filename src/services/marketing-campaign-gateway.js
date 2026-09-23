const SAFE_CAMPAIGN_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
const SAFE_REASON = /^[\p{L}\p{N} .,_'-]{0,500}$/u;
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

const campaignListItem = (value = {}) => ({
  campaignId: value.campaignId ?? null,
  vendorId: value.vendorId ?? null,
  businessName: value.businessName ?? null,
  campaignType: value.campaignType ?? null,
  reason: value.reason ?? null,
  createdAt: value.createdAt ?? null,
  generatedAt: value.generatedAt ?? value.updatedAt ?? null,
  updatedAt: value.updatedAt ?? null,
  approvedAt: value.approvedAt ?? null,
  videoUrl: value.videoUrl ?? null,
  approvalStatus: value.approvalStatus ?? null,
  generationStatus: value.generationStatus ?? null,
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
});

const cleanReason = (value) => {
  if (typeof value !== 'string') return '';
  const reason = value.trim().slice(0, 500);
  if (!SAFE_REASON.test(reason)) {
    throw new MarketingCampaignGatewayError('INVALID_REGENERATION_REASON', 400);
  }
  return reason;
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

  async request(path, { method = 'GET', body } = {}) {
    if (!this.baseUrl || !this.serviceKey || typeof this.fetchImpl !== 'function') {
      throw new MarketingCampaignGatewayError('MARKETING_CONTROL_UNAVAILABLE', 503);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
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

  async regenerateCampaign(campaignId, reason) {
    const id = requireCampaignId(campaignId);
    const data = await this.request(`/admin/campaigns/${encodeURIComponent(id)}/regenerate`, {
      method: 'POST', body: { reason: cleanReason(reason) },
    });
    const campaign = data?.result?.campaign ?? data?.campaign;
    return {
      action: data?.result?.action ?? data?.action ?? null,
      campaign: campaign ? campaignListItem(campaign) : null,
    };
  }
}

module.exports = {
  MarketingCampaignGateway,
  MarketingCampaignGatewayError,
  normalizeTimeoutMs,
  campaignListItem,
  campaignDetail,
};
