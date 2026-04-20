const { FileModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class FileService extends BaseService {
  constructor() {
    super(Model);
  }
}

module.exports = new FileService();
