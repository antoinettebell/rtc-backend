const { AmbassadorCodeModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class AmbassadorCodeService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new AmbassadorCodeService();
