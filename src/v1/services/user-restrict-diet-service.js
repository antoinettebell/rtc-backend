const { UserRestrictDietModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class UserRestrictDietService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new UserRestrictDietService();
