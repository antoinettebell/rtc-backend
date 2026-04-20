const { MeatModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class MeatService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new MeatService();
