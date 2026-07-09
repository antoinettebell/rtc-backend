require('dotenv').config();

const mongoose = require('mongoose');
const {
  FoodTruckModel,
  MarketplaceApplicationModel,
  MarketplaceAttachmentModel,
  MarketplaceBidModel,
} = require('../src/models');

const SYNC_ATTACHMENT_TYPES = [
  'AGREEMENT_DOCUMENT',
  'PERMIT_LICENSE',
  'REQUIREMENT_DOCUMENT',
];

const applyChanges = process.argv.includes('--apply');

const normalizeName = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

const documentTypeForAttachment = (attachment) => {
  const label = normalizeName(attachment.requirement_label);
  if (attachment.attachment_type === 'AGREEMENT_DOCUMENT') return 'OTHER';
  if (label.includes('insurance')) return 'INSURANCE';
  if (label.includes('license')) return 'LICENSE';
  return 'PERMIT';
};

const documentTitleForAttachment = (attachment) => {
  if (attachment.attachment_type === 'AGREEMENT_DOCUMENT') {
    return 'Signed Marketplace Agreement';
  }
  return (
    attachment.requirement_label ||
    attachment.original_name ||
    'Marketplace Document'
  );
};

const findFoodTruckIdForAttachment = async (attachment) => {
  if (attachment.bid_id) {
    const bid = await MarketplaceBidModel.findOne(
      { bid_id: attachment.bid_id },
      { food_truck_id: 1 }
    ).lean();
    if (bid?.food_truck_id) return bid.food_truck_id;
  }

  if (attachment.application_id) {
    const application = await MarketplaceApplicationModel.findOne(
      { application_id: attachment.application_id },
      { food_truck_id: 1 }
    ).lean();
    if (application?.food_truck_id) return application.food_truck_id;
  }

  return null;
};

const hasDocumentFile = (documents, attachment) =>
  documents.some(
    (document) =>
      (attachment.file_key && document.file_key === attachment.file_key) ||
      (attachment.file_url && document.file_url === attachment.file_url)
  );

const getAttachmentDate = (attachment) =>
  new Date(attachment.created_at || attachment.updated_at || 0).getTime();

const isNewerAttachment = (candidate, current) =>
  getAttachmentDate(candidate.attachment) > getAttachmentDate(current.attachment);

const run = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required.');
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('Database connected');

  const attachments = await MarketplaceAttachmentModel.find({
    attachment_type: { $in: SYNC_ATTACHMENT_TYPES },
    status: 'ACTIVE',
    file_url: { $nin: [null, ''] },
  })
    .sort({ created_at: 1 })
    .lean();

  const stats = {
    scanned: attachments.length,
    added: 0,
    skippedOlderVersion: 0,
    skippedExisting: 0,
    skippedMissingFoodTruck: 0,
    skippedMissingFoodTruckRecord: 0,
  };
  const latestByFoodTruckAndTitle = new Map();

  for (const attachment of attachments) {
    const foodTruckId = await findFoodTruckIdForAttachment(attachment);
    if (!foodTruckId) {
      stats.skippedMissingFoodTruck += 1;
      continue;
    }

    const title = documentTitleForAttachment(attachment);
    const key = `${foodTruckId}:${normalizeName(title)}`;
    const candidate = { attachment, foodTruckId, title };
    const current = latestByFoodTruckAndTitle.get(key);
    if (!current || isNewerAttachment(candidate, current)) {
      latestByFoodTruckAndTitle.set(key, candidate);
    }
  }

  stats.skippedOlderVersion =
    stats.scanned -
    latestByFoodTruckAndTitle.size -
    stats.skippedMissingFoodTruck;

  for (const { attachment, foodTruckId, title } of latestByFoodTruckAndTitle.values()) {
    const foodTruck = await FoodTruckModel.findById(foodTruckId);
    if (!foodTruck) {
      stats.skippedMissingFoodTruckRecord += 1;
      continue;
    }

    if (hasDocumentFile(foodTruck.documents || [], attachment)) {
      stats.skippedExisting += 1;
      continue;
    }

    const document = {
      title,
      document_type: documentTypeForAttachment(attachment),
      file_url: attachment.file_url,
      file_key: attachment.file_key || null,
      original_name: attachment.original_name || null,
      mime_type: attachment.mime_type || null,
      size_bytes: attachment.size_bytes || null,
      uploaded_by_user_id: attachment.uploaded_by_user_id || null,
      uploaded_at: attachment.created_at || new Date(),
      document_status: 'ACTIVE',
    };

    if (applyChanges) {
      foodTruck.documents.push(document);
      await foodTruck.save();
    }

    stats.added += 1;
    console.log(
      `${applyChanges ? 'Added' : 'Would add'} ${document.title} to food truck ${foodTruckId}`
    );
  }

  console.log(JSON.stringify({ mode: applyChanges ? 'apply' : 'dry-run', stats }, null, 2));
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
