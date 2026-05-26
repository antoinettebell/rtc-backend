const { MarketplaceAgreementAuditModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class MarketplaceAgreementAuditService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new MarketplaceAgreementAuditService();
