const { BannerModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class BannerService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new BannerService();
