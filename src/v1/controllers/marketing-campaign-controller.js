const { MarketingCampaignGateway } = require('../../services/marketing-campaign-gateway');

const gateway = new MarketingCampaignGateway();

const safeFailure = (res, error) => res.status(
  Number.isInteger(error?.status) ? error.status : 502
).json({
  success: false,
  data: { error: { code: error?.code || 'MARKETING_CONTROL_REQUEST_FAILED' } },
});

const createMarketingCampaignController = (service = gateway) => ({
  listPending: async (req, res) => {
    try {
      return res.data({ campaigns: await service.listPendingCampaigns() });
    } catch (error) { return safeFailure(res, error); }
  },
  listApproved: async (req, res) => {
    try {
      return res.data({ campaigns: await service.listApprovedCampaigns() });
    } catch (error) { return safeFailure(res, error); }
  },
  listEligibleVendors: async (req, res) => {
    try {
      return res.data({ vendors: await service.listEligibleVendors() });
    } catch (error) { return safeFailure(res, error); }
  },
  listEligibleAppFeatures: async (req, res) => {
    try {
      return res.data({ features: await service.listEligibleAppFeatures() });
    } catch (error) { return safeFailure(res, error); }
  },
  listEligibleEvents: async (req, res) => {
    try {
      return res.data({ events: await service.listEligibleEvents() });
    } catch (error) { return safeFailure(res, error); }
  },
  generate: async (req, res) => {
    try {
      return res.data({ results: await service.generateVendorSpotlights(
        req.body?.requestId,
        req.body?.vendorSelections ?? req.body?.vendorIds,
      ) });
    } catch (error) { return safeFailure(res, error); }
  },
  generateAppFeatures: async (req, res) => {
    try {
      return res.data({ results: await service.generateAppFeatures(
        req.body?.requestId,
        req.body?.featureSelections ?? (Array.isArray(req.body?.featureKeys)
          ? req.body.featureKeys.map((featureKey) => ({ featureKey, creativeMode: 'STANDARD_FEATURE' }))
          : req.body?.featureSelections),
      ) });
    } catch (error) { return safeFailure(res, error); }
  },
  generateEvents: async (req, res) => {
    try {
      return res.data({ results: await service.generateEvents(
        req.body?.requestId,
        req.body?.eventIds,
      ) });
    } catch (error) { return safeFailure(res, error); }
  },
  getDetails: async (req, res) => {
    try {
      return res.data({ campaign: await service.getCampaignDetails(req.params.campaignId) });
    } catch (error) { return safeFailure(res, error); }
  },
  approve: async (req, res) => {
    try {
      return res.data({ campaign: await service.approveCampaign(
        req.params.campaignId,
        String(req.user?._id || req.user?.id || '')
      ) });
    } catch (error) { return safeFailure(res, error); }
  },
  discard: async (req, res) => {
    try {
      return res.data({ campaign: await service.discardCampaign(req.params.campaignId) });
    } catch (error) { return safeFailure(res, error); }
  },
  regenerate: async (req, res) => {
    try {
      return res.data({ result: await service.regenerateCampaign(
        req.params.campaignId, req.body?.reason
      ) });
    } catch (error) { return safeFailure(res, error); }
  },
  listSocialContent: async (req, res) => {
    try {
      return res.data({ content: await service.listSocialContent({
        brandCode: req.query?.brand,
        lifecycleStatus: req.query?.status,
      }) });
    } catch (error) { return safeFailure(res, error); }
  },
  requestSocialContentDecision: async (req, res) => {
    try { return res.status(202).data({ content: await service.requestSocialContentDecision(req.body?.brandCode, req.body?.format) }); }
    catch (error) { return safeFailure(res, error); }
  },
  completeSocialContentVerification: async (req, res) => {
    try { return res.data({ content: await service.completeSocialContentVerification(req.params.contentId) }); }
    catch (error) { return safeFailure(res, error); }
  },
  getSocialContent: async (req, res) => {
    try { return res.data({ content: await service.getSocialContent(req.params.contentId) }); }
    catch (error) { return safeFailure(res, error); }
  },
  generateSocialContentCreative: async (req, res) => {
    try { return res.status(202).data({ content: await service.generateSocialContentCreative(req.params.contentId) }); }
    catch (error) { return safeFailure(res, error); }
  },
  regenerateSocialContentCreative: async (req, res) => {
    try { return res.status(202).data({ content: await service.regenerateSocialContentCreative(req.params.contentId) }); }
    catch (error) { return safeFailure(res, error); }
  },
  getSocialContentCreativePreview: async (req, res) => {
    try { return res.data(await service.getSocialContentCreativePreview(req.params.contentId)); }
    catch (error) { return safeFailure(res, error); }
  },
  approveSocialContent: async (req, res) => {
    try { return res.data({ content: await service.approveSocialContent(req.params.contentId, String(req.user?._id || req.user?.id || '')) }); }
    catch (error) { return safeFailure(res, error); }
  },
  rejectSocialContent: async (req, res) => {
    try { return res.data({ content: await service.rejectSocialContent(req.params.contentId, String(req.user?._id || req.user?.id || '')) }); }
    catch (error) { return safeFailure(res, error); }
  },
});

module.exports = createMarketingCampaignController();
module.exports.createMarketingCampaignController = createMarketingCampaignController;
