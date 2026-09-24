const { MarketplaceBidAmendmentModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class MarketplaceBidAmendmentService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new MarketplaceBidAmendmentService();
