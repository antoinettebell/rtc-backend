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

const buildMarketplaceMessageNotification = (message, event, viewer) => {
  const unread = getMarketplaceMessageUnreadState(message, viewer);
  let title = unread ? 'Marketplace question answered' : 'Marketplace conversation';
  if (message.initiated_by_role === 'CUSTOMER') {
    title = unread ? 'New coordinator message' : 'Coordinator message';
  }
  return {
    id: `marketplace-message-${message.question_id}`,
    type: 'MARKETPLACE_MESSAGE',
    event_id: message.event_id,
    event_name: event?.event_name || event?.event_type || 'Marketplace event',
    event_date: event?.event_date || null,
    title,
    subtitle: 'Open event messages to review and reply.',
    question_id: message.question_id,
    bid_id: message.bid_id || null,
    application_id: message.application_id || null,
    unread,
    occurred_at: message.answered_at || message.created_at || null,
  };
};

module.exports = {
  isMarketplaceMessageVisibleToVendor,
  isMarketplaceMessageInSubmission,
  getMarketplaceMessageUnreadState,
  buildMarketplaceMessageNotification,
};
