const { SettingModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class SettingService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new SettingService();
