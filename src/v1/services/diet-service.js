const { DietModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class DietService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new DietService();
