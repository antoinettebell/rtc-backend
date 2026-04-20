const { UserModel } = require('../models');
const FCM = require('./fcm');

exports.getFCMTokens = async (userIds, toGrouped = true) => {
  const returnData = {};
  const data = await UserModel.find(
    {
      _id: { $in: userIds },
    },
    { _id: 1, fcmTokens: 1, firstName: 1, lastName: 1 }
  );
  if (!toGrouped) {
    return data;
  }
  data.forEach((item) => {
    returnData[item._id.toString()] = item;
  });
  return returnData;
};

/**
 * @param notificationData: {
 *   [userId: string]: {
 *     title: string,
 *     body: string,
 *     data: { [key: string]: string },
 *   }
 * }
 */
exports.sendNotificationToUsers = async (notificationData) => {
  const tokensWithId =
    (await this.getFCMTokens(Object.keys(notificationData), false)) || [];
  tokensWithId.forEach((item) => {
    const note = notificationData[item._id.toString()];
    if (note) {
      const title = (note.title || '')
        .replaceAll('{firstName}', item.firstName)
        .replaceAll('{lastName}', item.lastName);
      const body = (note.body || '')
        .replaceAll('{firstName}', item.firstName)
        .replaceAll('{lastName}', item.lastName);
      (item.fcmTokens || []).forEach((itm) => {
        FCM.sendNotification(title, body, note.data || {}, itm.token);
      });
    }
  });
};

exports.sendNewOrderNotification = async (vendor, orderId) => {
  try {
    const title = 'New order';
    const body = `You've have a new Order`;
    const noteData = {
      [vendor._id.toString()]: {
        title,
        body,
        data: {
          orderId: orderId.toString(),
          activityType: 'NEW_ORDER',
        },
      },
    };

    await this.sendNotificationToUsers(noteData);
  } catch (e) {
    console.log('========Error in sendNewOrderNotification', e);
  }
};

exports.sendOrderStatusNotification = async (user, orderId, status) => {
  try {
    const statusKey = {
      PLACED: {
        title: 'Order placed',
        body: 'Your order is successfully placed.',
      },
      ACCEPTED: {
        title: 'Order accepted',
        body: 'Your order is accepted by the vendor.',
      },
      CANCEL: {
        title: 'Order canceled',
        body: 'Order is canceled by customer.',
      },
      REJECTED: {
        title: 'Order rejected',
        body: 'Your order is rejected by the vendor.',
      },
      PREPARING: {
        title: 'Preparing order',
        body: 'Your order is started being prepared.',
      },
      READY_FOR_PICKUP: {
        title: 'Order ready',
        body: 'Your food is ready for the pickup.',
      },
      COMPLETED: {
        title: 'Order complete',
        body: 'Enjoy your food.',
      },
    };

    if (statusKey[status]) {
      const title = statusKey[status].title;
      const body = statusKey[status].body;
      const noteData = {
        [user._id.toString()]: {
          title,
          body,
          data: {
            orderId: orderId.toString(),
            status,
            activityType: 'ORDER_STATUS',
          },
        },
      };

      await this.sendNotificationToUsers(noteData);
    }
  } catch (e) {
    console.log('========Error in sendOrderStatusNotification', e);
  }
};

exports.sendStatusNotificationToVendor = async (vendor, status) => {
  try {
    const title = 'Request status';
    const body = `Your request for the foodtruck is ${status.toLowerCase()}`;
    const noteData = {
      [vendor._id.toString()]: {
        title,
        body,
        data: {
          activityType: 'REQUEST_STATUS',
        },
      },
    };

    await this.sendNotificationToUsers(noteData);
  } catch (e) {
    console.log('========Error in sendNewOrderNotification', e);
  }
};
exports.sendBadReviewNotificationToVendor = async (vendor, orderId = null,foodTruckId=null) => {
  try {
    const title = 'Feedback Alert';
    const body = `We noticed a low rating was left on your food truck. This is a great chance to identify areas for improvement.`;
    const noteData = {
      [vendor._id.toString()]: {
        title,
        body,
        data: {
          foodTruckId: foodTruckId ? foodTruckId.toString() : null,
          orderId: orderId ? orderId.toString() : null,
          activityType: 'BAD_REVIEW',
          
        },
      },
    };

    await this.sendNotificationToUsers(noteData);
  } catch (e) {
    console.log('========Error in sendNewOrderNotification', e);
  }
};


