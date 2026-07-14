const fs = require('fs');
const axios = require('axios');
const Textract = require('aws-sdk/clients/textract');
const sharp = require('sharp');
const heicConvert = require('heic-convert');

const textract = new Textract({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const CONTACT_PATTERNS = [
  {
    reason: 'email',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  },
  {
    reason: 'phone_number',
    pattern:
      /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/,
  },
  {
    reason: 'social_handle',
    pattern: /(^|[\s(])@[A-Z0-9._-]{3,30}\b/i,
  },
  {
    reason: 'social_link',
    pattern:
      /\b(?:instagram|insta|facebook|fb|tiktok|twitter|x\.com|snapchat|linkedin|linktr\.ee|linktree)\b/i,
  },
  {
    reason: 'website',
    pattern:
      /\b(?:https?:\/\/|www\.)[^\s]+|\b[A-Z0-9-]+\.(?:com|net|org|co|io|us|biz)\b/i,
  },
];

const normalizeImageForOcr = async (file) => {
  const input = fs.readFileSync(file.path);
  const isHeic =
    /hei[cf]/i.test(file.mimetype || '') ||
    /\.(hei[cf])$/i.test(file.originalname || '');

  const imageBuffer = isHeic
    ? Buffer.from(
        await heicConvert({
          buffer: input,
          format: 'JPEG',
          quality: 0.85,
        })
      )
    : input;

  return sharp(imageBuffer)
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();
};

const findContactInfoMatches = (texts = []) => {
  const matches = [];

  texts.forEach((text) => {
    CONTACT_PATTERNS.forEach(({ reason, pattern }) => {
      if (pattern.test(text)) {
        matches.push({ reason, text });
      }
    });
  });

  return matches;
};

const detectTextWithAzureFunction = async (bytes) => {
  if (!process.env.COMPLIANCE_OCR_ENDPOINT) {
    return null;
  }

  const response = await axios.post(
    process.env.COMPLIANCE_OCR_ENDPOINT,
    {
      scan_type: 'marketplace_event_image_contact_info',
      image_bytes_base64: bytes.toString('base64'),
    },
    {
      timeout: Number(process.env.COMPLIANCE_OCR_TIMEOUT_MS || 20000),
    }
  );

  return response.data;
};

exports.assertMarketplaceEventImageHasNoContactInfo = async (file) => {
  const ocrEnabled = String(
    process.env.COMPLIANCE_OCR_ENABLED || 'false'
  ).toLowerCase() === 'true';

  if (!ocrEnabled) {
    return {
      moderation_status: 'SKIPPED',
      moderation_reason: 'COMPLIANCE_OCR_DISABLED',
    };
  }

  const bytes = await normalizeImageForOcr(file);
  const remoteResult = await detectTextWithAzureFunction(bytes);
  const detectedText = remoteResult
    ? []
    : await textract
        .detectDocumentText({
          Document: {
            Bytes: bytes,
          },
        })
        .promise()
        .then((response) =>
          (response.Blocks || [])
            .filter(
              (item) =>
                item.BlockType === 'LINE' &&
                Number(item.Confidence || 0) >= 70
            )
            .map((item) => item.Text || '')
            .filter(Boolean)
        );
  const matches = remoteResult
    ? remoteResult.matches || []
    : findContactInfoMatches(detectedText);

  if (
    matches.length ||
    String(remoteResult?.moderation_status || '').toUpperCase() === 'BLOCKED'
  ) {
    const error = new Error(
      'Event images cannot include contact information such as phone numbers, emails, websites, or social handles.'
    );
    error.code = 400;
    error.details = {
      moderation_status: 'BLOCKED',
      moderation_reasons:
        remoteResult?.moderation_reasons ||
        [...new Set(matches.map((item) => item.reason))],
    };
    throw error;
  }

  return {
    moderation_status: 'APPROVED',
    detected_text_count:
      remoteResult?.detected_text_count === undefined
        ? detectedText.length
        : remoteResult.detected_text_count,
  };
};
