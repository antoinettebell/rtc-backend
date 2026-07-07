const { MarketplaceVendorAgreementModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class MarketplaceVendorAgreementService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new MarketplaceVendorAgreementService();
