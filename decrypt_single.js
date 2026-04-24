const cryptLib = require('cryptlib');
const secret = process.env.ENCRYPTION_SECRET_KEY;
if (!secret) { console.error('ENCRYPTION_SECRET_KEY not set'); process.exit(2); }
const cipher = process.argv[2];
if (!cipher) { console.error('Usage: node decrypt_single.js "<iv:ciphertext>"'); process.exit(2); }
if (!cipher.includes(':')) { console.log('NOT_ENCRYPTED:', cipher); process.exit(0); }
const parts = cipher.split(':');
const iv = parts.shift();
const cipherText = parts.join(':');
const key = cryptLib.getHashSha256(secret, 32);
try {
  const plain = cryptLib.decrypt(cipherText, key, iv);
  console.log(plain);
} catch (err) {
  console.error('Decrypt error:', err.message || err);
  process.exit(3);
}
