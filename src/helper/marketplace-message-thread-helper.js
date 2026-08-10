const sameId = (left, right) => String(left || '') === String(right || '');

const isMarketplaceMessageVisibleToVendor = (message, vendorUserId) =>
  sameId(message?.vendor_user_id, vendorUserId);

const isMarketplaceMessageInSubmission = (message, { bidId = null, applicationId = null } = {}) => {
  if (bidId) return message?.bid_id === bidId;
  if (applicationId) return message?.application_id === applicationId;
  return !message?.bid_id && !message?.application_id;
};

const getMarketplaceMessageUnreadState = (message, viewer) => {
  if (!viewer) return false;
  if (viewer.userType === 'CUSTOMER' || viewer.userType === 'SUPER_ADMIN') {
    return !message.coordinator_read_at;
  }
  if (viewer.userType !== 'VENDOR' || !isMarketplaceMessageVisibleToVendor(message, viewer._id)) {
    return false;
  }
  const relevantAt = message.initiated_by_role === 'CUSTOMER'
    ? message.created_at
    : message.answered_at;
  return !!relevantAt && (!message.vendor_read_at || new Date(message.vendor_read_at) < new Date(relevantAt));
};

module.exports = {
  isMarketplaceMessageVisibleToVendor,
  isMarketplaceMessageInSubmission,
  getMarketplaceMessageUnreadState,
};
