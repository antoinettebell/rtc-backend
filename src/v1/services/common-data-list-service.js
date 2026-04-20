const { commonDatalistModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class CommonDataListService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new CommonDataListService();
