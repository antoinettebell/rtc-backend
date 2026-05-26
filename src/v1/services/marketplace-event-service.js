const {
  MarketplaceEventModel: Model,
  MarketplaceEventImageModel,
  MarketplaceBidModel,
} = require('../../models');
const { BaseService } = require('../../common-services');

class MarketplaceEventService extends BaseService {
  constructor() {
    super(Model);
  }

  async getWithImages(event_id) {
    const event = await Model.findOne({ event_id }).lean();
    if (!event) {
      return null;
    }

    const images = await MarketplaceEventImageModel.find({
      event_id,
      status: 'ACTIVE',
    })
      .sort({ created_at: 1 })
      .lean();

    return {
      ...event,
      images,
    };
  }

  async getMyEvents(customer_user_id) {
    const events = await Model.find({ customer_user_id })
      .sort({ created_at: -1 })
      .lean();
    const eventIds = events.map((event) => event.event_id);
    const bidCounts = await MarketplaceBidModel.aggregate([
      { $match: { event_id: { $in: eventIds } } },
      { $group: { _id: '$event_id', total: { $sum: 1 } } },
    ]);
    const countByEventId = bidCounts.reduce((acc, item) => {
      acc[item._id] = item.total;
      return acc;
    }, {});

    return events.map((event) => ({
      ...event,
      bid_count: countByEventId[event.event_id] || 0,
    }));
  }
}

module.exports = new MarketplaceEventService();
