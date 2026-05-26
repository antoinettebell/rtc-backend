const { MarketplaceAttachmentModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class MarketplaceAttachmentService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new MarketplaceAttachmentService();
