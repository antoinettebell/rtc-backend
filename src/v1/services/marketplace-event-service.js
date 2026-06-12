const {
  MarketplaceEventModel: Model,
  MarketplaceEventImageModel,
  MarketplaceBidModel,
  MarketplaceApplicationModel,
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

    let awarded_bids = [];
    let awarded_applications = [];

    if (event.status === 'AWARDED') {
      awarded_bids = await MarketplaceBidModel.find({
        event_id,
        bid_status: 'AWARDED',
      })
        .populate('vendor_user_id', 'firstName lastName email')
        .populate('food_truck_id', 'name logo')
        .sort({ updated_at: -1 })
        .lean();

      awarded_applications = await MarketplaceApplicationModel.find({
        event_id,
        application_status: { $in: ['ACCEPTED', 'PAYMENT_DUE', 'PAID', 'CONFIRMED'] },
      })
        .populate('vendor_user_id', 'firstName lastName email')
        .populate('food_truck_id', 'name logo')
        .sort({ updated_at: -1 })
        .lean();

      const bidIds = awarded_bids.map((bid) => bid.bid_id).filter(Boolean);
      const applicationIds = awarded_applications
        .map((application) => application.application_id)
        .filter(Boolean);
      const attachmentQuery = [
        ...(bidIds.length ? [{ bid_id: { $in: bidIds } }] : []),
        ...(applicationIds.length
          ? [{ application_id: { $in: applicationIds } }]
          : []),
      ];
      const attachments = attachmentQuery.length
        ? await MarketplaceAttachmentModel.find({
            status: 'ACTIVE',
            $or: attachmentQuery,
          })
            .sort({ created_at: 1 })
            .lean()
        : [];

      const attachmentsByBidId = attachments.reduce((acc, attachment) => {
        if (attachment.bid_id) {
          acc[attachment.bid_id] = acc[attachment.bid_id] || [];
          acc[attachment.bid_id].push(attachment);
        }
        return acc;
      }, {});
      const attachmentsByApplicationId = attachments.reduce((acc, attachment) => {
        if (attachment.application_id) {
          acc[attachment.application_id] = acc[attachment.application_id] || [];
          acc[attachment.application_id].push(attachment);
        }
        return acc;
      }, {});

      awarded_bids = awarded_bids.map((bid) => ({
        ...bid,
        attachments: attachmentsByBidId[bid.bid_id] || [],
      }));
      awarded_applications = awarded_applications.map((application) => ({
        ...application,
        attachments: attachmentsByApplicationId[application.application_id] || [],
      }));
    }

    return {
      ...event,
      images,
      awarded_bids,
      awarded_applications,
    };
  }

  async attachImages(events = []) {
    const eventIds = events.map((event) => event.event_id).filter(Boolean);
    if (!eventIds.length) {
      return events;
    }

    const images = await MarketplaceEventImageModel.find({
      event_id: { $in: eventIds },
      status: 'ACTIVE',
    })
      .sort({ created_at: 1 })
      .lean();

    const imagesByEventId = images.reduce((acc, image) => {
      acc[image.event_id] = acc[image.event_id] || [];
      acc[image.event_id].push(image);
      return acc;
    }, {});

    return events.map((event) => ({
      ...event,
      images: imagesByEventId[event.event_id] || [],
    }));
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
    const applicationCounts = await MarketplaceApplicationModel.aggregate([
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
    const applicationCountByEventId = applicationCounts.reduce((acc, item) => {
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
      application_count: applicationCountByEventId[event.event_id] || 0,
      submission_count:
        (countByEventId[event.event_id] || 0) +
        (applicationCountByEventId[event.event_id] || 0),
      awarded_bids: awardedBidsByEventId[event.event_id] || [],
    }));
  }
}

module.exports = new MarketplaceEventService();
