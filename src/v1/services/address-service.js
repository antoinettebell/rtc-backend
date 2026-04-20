const { AddressModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class AddressService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new AddressService();
