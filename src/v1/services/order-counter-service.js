const { OrderCounterModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class OrderCounterService extends BaseService {
  constructor() {
    super(Model);
  }

  async updateTheCounter(foodTruckId) {
    return await Model.findOneAndUpdate(
      { foodTruckId },
      { $inc: { sequenceValue: 1 } },
      { new: true, upsert: true }
    );
  }
}

module.exports = new OrderCounterService();
