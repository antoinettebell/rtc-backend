const { MarketplaceEventQuestionModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class MarketplaceEventQuestionService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new MarketplaceEventQuestionService();
