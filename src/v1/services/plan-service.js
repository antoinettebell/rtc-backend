const { PlanModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class PlanService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new PlanService();
