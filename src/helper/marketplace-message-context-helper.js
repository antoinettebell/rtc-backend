const buildMarketplaceMessageScope = ({ bidId = null, applicationId = null } = {}) => {
  if (bidId && applicationId) {
    throw Object.assign(new Error('Choose either a bid or application conversation.'), { code: 400 });
  }
  return bidId ? { bid_id: bidId } : applicationId ? { application_id: applicationId } : {};
};

const assertMarketplaceMessageParticipantContext = ({
  foodTruckId = null,
  eventVendorProfileId = null,
  bidId = null,
  applicationId = null,
}) => {
  if (!!foodTruckId === !!eventVendorProfileId) {
    throw Object.assign(new Error('Marketplace message participant could not be resolved.'), { code: 400 });
  }
  buildMarketplaceMessageScope({ bidId, applicationId });
  return true;
};

const resolveMarketplaceSubmissionParticipant = ({
  foodBid = null,
  foodApplication = null,
  eventVendorApplication = null,
  fallbackFoodTruckId = null,
  fallbackEventVendorProfileId = null,
} = {}) => {
  const matches = [foodBid, foodApplication, eventVendorApplication].filter(Boolean);
  if (matches.length > 1) {
    throw Object.assign(new Error('Marketplace submission participant is ambiguous.'), { code: 400 });
  }
  if (foodBid) {
    return { foodTruckId: foodBid.food_truck_id, eventVendorProfileId: null, displayIdentity: foodBid.food_truck_id };
  }
  if (foodApplication) {
    return { foodTruckId: foodApplication.food_truck_id, eventVendorProfileId: null, displayIdentity: foodApplication.food_truck_id };
  }
  if (eventVendorApplication) {
    return { foodTruckId: null, eventVendorProfileId: eventVendorApplication.profile_id, displayIdentity: eventVendorApplication.profile_id };
  }
  if (fallbackEventVendorProfileId) {
    return { foodTruckId: null, eventVendorProfileId: fallbackEventVendorProfileId, displayIdentity: fallbackEventVendorProfileId };
  }
  if (fallbackFoodTruckId) {
    return { foodTruckId: fallbackFoodTruckId, eventVendorProfileId: null, displayIdentity: fallbackFoodTruckId };
  }
  throw Object.assign(new Error('Marketplace message participant could not be resolved.'), { code: 400 });
};

module.exports = {
  buildMarketplaceMessageScope,
  assertMarketplaceMessageParticipantContext,
  resolveMarketplaceSubmissionParticipant,
};
