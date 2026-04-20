const S3 = require('aws-sdk/clients/s3');
const { aws } = require('../config');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const s3 = new S3({
  region: 'us-east-1',
  signatureVersion: 'v4',
  accessKeyId: aws.s3Access,
  secretAccessKey: aws.s3Secret,
});

exports.addObject = (file) =>
  new Promise((resolve, reject) => {
    // const fileContent = fs.readFileSync(file.path);
    const fileContent = fs.createReadStream(file.path);

    const key = `${uuidv4()}.${file.originalname.split('.').pop()}`;
    const url = `https://${aws.s3Bucket}.s3.us-east-1.amazonaws.com/${key}`;
    s3.putObject(
      {
        Bucket: aws.s3Bucket,
        // ACL: 'public-read',
        Key: key,
        Body: fileContent,
        ContentType: file.mimetype,
      },
      (err, data) => {
        if (err) {
          console.error('Error creating file:', err);
          reject(err);
        } else {
          resolve(url);
        }
      }
    );
  });

exports.removeObject = (name) =>
  new Promise((resolve) => {
    s3.deleteObject(
      {
        Bucket: aws.s3Bucket,
        Key: name,
      },
      (err, data) => {
        if (err) {
          console.error('Error deleting file:', err);
          resolve(null);
        } else {
          resolve(true);
        }
      }
    );
  });

exports.removeMultipleObjects = (keyList) =>
  new Promise((resolve) => {
    s3.deleteObjects(
      {
        Bucket: aws.s3Bucket,
        Delete: {
          Objects: keyList,
        },
      },
      (err, data) => {
        if (err) {
          console.error('Error deleting file:', err);
          resolve(null);
        } else {
          resolve(true);
        }
      }
    );
  });
