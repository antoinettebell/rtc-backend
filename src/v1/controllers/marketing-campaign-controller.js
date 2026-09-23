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
  generate: async (req, res) => {
    try {
      return res.data({ results: await service.generateVendorSpotlights(req.body?.requestId) });
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
  regenerate: async (req, res) => {
    try {
      return res.data({ result: await service.regenerateCampaign(
        req.params.campaignId, req.body?.reason
      ) });
    } catch (error) { return safeFailure(res, error); }
  },
});

module.exports = createMarketingCampaignController();
module.exports.createMarketingCampaignController = createMarketingCampaignController;
