const { CuisineModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class CuisineService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new CuisineService();
