const { VendorComplianceAuditModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class VendorComplianceAuditService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new VendorComplianceAuditService();
