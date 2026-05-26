const { MarketplaceFileAuditModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class MarketplaceFileAuditService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new MarketplaceFileAuditService();
