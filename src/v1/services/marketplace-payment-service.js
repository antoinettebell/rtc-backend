const { MarketplacePaymentModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class MarketplacePaymentService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new MarketplacePaymentService();
