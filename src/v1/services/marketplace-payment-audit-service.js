const { MarketplacePaymentAuditModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class MarketplacePaymentAuditService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new MarketplacePaymentAuditService();
