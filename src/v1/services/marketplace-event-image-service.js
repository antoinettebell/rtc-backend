const { MarketplaceEventImageModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class MarketplaceEventImageService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new MarketplaceEventImageService();
