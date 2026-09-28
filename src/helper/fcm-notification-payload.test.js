const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'fcm.js'), 'utf8');

assert.match(source, /channelId: 'rtc-notifications-v3'/);
assert.match(source, /priority: 'high'/);
assert.match(source, /sound: 'default'/);
assert.match(source, /'interruption-level': 'active'/);
assert.doesNotMatch(source, /critical/);

console.log('FCM notification payload tests passed');
