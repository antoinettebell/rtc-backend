const admin = require('firebase-admin');
const serviceAccount = require('./rtc-app-59500-firebase-adminsdk-fbsvc-e4bb241c1d.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

exports.sendNotification = (title, body, data, userFCMToken) => {
  const message = {
    notification: {
      title,
      body,
    },
    data,
    token: userFCMToken,
  };
  admin
    .messaging()
    .send(message)
    .then((response) => {
      console.log('===============notification sent');
    })
    .catch((error) => {
      if (error?.code === 'messaging/third-party-auth-error') {
        console.warn('Push notification skipped: Firebase credentials need attention', {
          code: error.code,
          tokenPresent: !!userFCMToken,
        });
        return;
      }
      console.error('Error sending notification:', {
        code: error?.code,
        message: error?.message,
      });
    });
};
