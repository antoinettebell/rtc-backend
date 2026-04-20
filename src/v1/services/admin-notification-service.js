const { BaseService } = require('../../common-services');
const { AdminNotificationModel: Model } = require('../../models');

class AdminNotificationService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new AdminNotificationService();
