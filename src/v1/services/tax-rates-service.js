const { TaxRatesModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class TaxRatesService extends BaseService {
  constructor() {
    super(Model);
  }

  async updateDetail(slug, data) {
    return await Model.findOneAndUpdate(
      { slug },
      { $set: { ...data, slug } },
      { new: true, upsert: true }
    );
  }
}

module.exports = new TaxRatesService();
