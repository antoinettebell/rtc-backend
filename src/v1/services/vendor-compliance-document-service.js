const { VendorComplianceDocumentModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class VendorComplianceDocumentService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new VendorComplianceDocumentService();
