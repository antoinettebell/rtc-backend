const {
  MarketplaceEventModel: Model,
  MarketplaceEventImageModel,
  MarketplaceBidModel,
  MarketplaceAttachmentModel,
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
    const awardedBids = await MarketplaceBidModel.find({
      event_id: { $in: eventIds },
      bid_status: 'AWARDED',
    })
      .populate('vendor_user_id', 'firstName lastName email')
      .populate('food_truck_id', 'name logo')
      .sort({ updated_at: -1 })
      .lean();
    const awardedBidIds = awardedBids.map((bid) => bid.bid_id);
    const attachments = awardedBidIds.length
      ? await MarketplaceAttachmentModel.find({
          bid_id: { $in: awardedBidIds },
          status: 'ACTIVE',
        })
          .sort({ created_at: 1 })
          .lean()
      : [];
    const countByEventId = bidCounts.reduce((acc, item) => {
      acc[item._id] = item.total;
      return acc;
    }, {});
    const attachmentsByBidId = attachments.reduce((acc, attachment) => {
      acc[attachment.bid_id] = acc[attachment.bid_id] || [];
      acc[attachment.bid_id].push(attachment);
      return acc;
    }, {});
    const awardedBidsByEventId = awardedBids.reduce((acc, bid) => {
      acc[bid.event_id] = acc[bid.event_id] || [];
      acc[bid.event_id].push({
        ...bid,
        attachments: attachmentsByBidId[bid.bid_id] || [],
      });
      return acc;
    }, {});

    return events.map((event) => ({
      ...event,
      bid_count: countByEventId[event.event_id] || 0,
      awarded_bids: awardedBidsByEventId[event.event_id] || [],
    }));
  }
}

module.exports = new MarketplaceEventService();
