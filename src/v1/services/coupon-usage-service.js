const { CouponUsageModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class CouponUsageService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new CouponUsageService();
