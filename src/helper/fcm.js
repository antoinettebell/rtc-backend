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
      console.error('Error sending notification:', error);
    });
};
