const { CouponModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class CouponService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new CouponService();
