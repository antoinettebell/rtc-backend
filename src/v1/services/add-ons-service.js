const { AddOnsModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class AddOnsService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new AddOnsService();
