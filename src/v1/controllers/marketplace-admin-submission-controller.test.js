const assert = require('assert');
const Module = require('module');
const path = require('path');

const controllerPath = path.join(__dirname, 'marketplace-controller.js');
const originalLoad = Module._load;
const noopModule = new Proxy({}, { get: () => () => undefined });

const createRecord = (overrides = {}) => ({
  event_id: 'event-1',
  bid_id: 'bid-1',
  bid_status: 'SUBMITTED',
  menu_description: 'Original menu',
  price_per_guest: 25,
  archived_at: null,
  deleted_at: null,
  saveCalls: 0,
  async save() { this.saveCalls += 1; },
  toObject() {
    return Object.fromEntries(Object.entries(this).filter(([, value]) => typeof value !== 'function'));
  },
  ...overrides,
});

const createQuery = (value) => {
  const query = {
    populate() { return query; },
    sort() { return query; },
    session() { return query; },
    lean() { return Promise.resolve(value); },
    exec() { return Promise.resolve(value); },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
  return query;
};

const loadController = (
  record,
  {
    finalPayment = null,
    attachments = [],
    replacementUpload = {
      url: 'https://files.example/replacement.pdf',
      key: 'marketplace/replacement.pdf',
    },
    failAudit = false,
  } = {}
) => {
  const audits = [];
  const attachmentUpdates = [];
  const createdAttachments = [];
  const paymentUpdates = [];
  const removedObjectKeys = [];
  let draft = null;
  const session = {
    async withTransaction(callback) { return callback(); },
    async endSession() {},
  };
  const serviceNames = [
    'FoodTruckService', 'MarketplaceApplicationService', 'MarketplaceAttachmentService',
    'MarketplaceAgreementAuditService', 'MarketplaceBidService', 'MarketplaceEventImageService',
    'MarketplaceEventQuestionService', 'MarketplaceEventService', 'MarketplaceFileAuditService',
    'MarketplacePaymentAuditService', 'MarketplacePaymentService',
    'MarketplaceVendorAgreementService', 'UserService', 'VendorComplianceDocumentService',
  ];
  const services = Object.fromEntries(serviceNames.map((name) => [name, {}]));
  const models = {
    EventVendorApplicationModel: { findOne: () => createQuery(null) },
    EventVendorProfileModel: {},
    MarketplaceAdminAuditModel: {
      async create(values) {
        if (failAudit) throw new Error('audit unavailable');
        audits.push(...values);
      },
    },
    MarketplaceAdminDraftModel: {
      findOne: () => createQuery(draft),
      async findOneAndUpdate(filter, update) {
        draft = {
          draft_key: update.$set.draft_key,
          ...update.$set,
          created_at: draft?.created_at || new Date(),
        };
        return draft;
      },
      deleteOne() {
        return { async session() { draft = null; } };
      },
    },
    MarketplaceApplicationModel: { findOne: () => createQuery(null) },
    MarketplaceAttachmentModel: {
      find: () => createQuery(attachments),
      findOne: (query) => createQuery(
        attachments.find((attachment) =>
          attachment.attachment_id === query.attachment_id
          && attachment.event_id === query.event_id
        ) || null
      ),
      async create(values) {
        const created = values.map((value, index) => ({
          attachment_id: `replacement-${index + 1}`,
          ...value,
          toObject() { return { ...this }; },
        }));
        createdAttachments.push(...created);
        return created;
      },
      async updateMany(query, update) { attachmentUpdates.push({ query, update }); },
    },
    MarketplaceBidModel: { findOne: () => createQuery(record) },
    MarketplacePaymentModel: {
      findOne: () => createQuery(finalPayment),
      async updateMany(query, update) { paymentUpdates.push({ query, update }); },
    },
    OperationalNotificationModel: {},
  };

  Module._load = (request, parent, isMain) => {
    if (parent?.filename === controllerPath) {
      if (request === 'mongoose') {
        const mongoose = originalLoad(request, parent, isMain);
        return new Proxy(mongoose, {
          get(target, property) {
            if (property === 'startSession') return async () => session;
            return target[property];
          },
        });
      }
      if (request === '../services') return services;
      if (request === '../../models') return models;
      if (request === '../../config') return { docusign: {} };
      if (request === '../../helper/aws') {
        return {
          addObjectFromBufferWithKey: async () => undefined,
          addObjectWithKey: async () => replacementUpload,
          removeObject: async (key) => { removedObjectKeys.push(key); },
        };
      }
      if (request === '../../helper/marketplace-admin-submission') {
        return originalLoad(request, parent, isMain);
      }
      if (request.startsWith('../../helper/') || request.startsWith('../services/')) {
        return noopModule;
      }
    }
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[require.resolve(controllerPath)];
  const controller = require(controllerPath);
  Module._load = originalLoad;
  return {
    attachmentUpdates,
    audits,
    controller,
    createdAttachments,
    getDraft: () => draft,
    paymentUpdates,
    removedObjectKeys,
  };
};

const execute = async (method, record, body, options = {}) => {
  const harness = loadController(record, options);
  let response;
  let error;
  await harness.controller[method](
    {
      params: {
        eventId: 'event-1',
        submissionType: 'FOOD_BID',
        submissionId: 'bid-1',
        ...(options.params || {}),
      },
      user: { _id: 'admin-1', userType: 'SUPER_ADMIN' },
      body,
      file: options.file,
    },
    { data(payload, message) { response = { payload, message }; } },
    (nextError) => { error = nextError; }
  );
  return { ...harness, error, response };
};

(async () => {
  const draftRecord = createRecord();
  const drafted = await execute('adminUpdateMarketplaceSubmission', draftRecord, {
    menu_description: 'Saved but not published',
    admin_reason: 'Vendor requested correction',
    save_mode: 'DRAFT',
  });
  assert.equal(drafted.error, undefined);
  assert.equal(draftRecord.menu_description, 'Original menu');
  assert.equal(draftRecord.saveCalls, 0);
  assert.equal(drafted.getDraft().payload.menu_description, 'Saved but not published');
  assert.equal(drafted.audits.length, 0);

  const editableRecord = createRecord();
  const edited = await execute('adminUpdateMarketplaceSubmission', editableRecord, {
    menu_description: 'Corrected by Admin',
    business_name: 'Not a bid field',
    admin_reason: 'Vendor requested correction',
    save_mode: 'PUBLISH',
  });
  assert.equal(edited.error, undefined);
  assert.equal(editableRecord.menu_description, 'Corrected by Admin');
  assert.equal(editableRecord.business_name, undefined, 'unsupported fields are not persisted');
  assert.equal(editableRecord.saveCalls, 1);
  assert.equal(edited.audits.length, 1);
  assert.equal(edited.audits[0].reason, 'Vendor requested correction');
  assert.equal(edited.getDraft(), null, 'published draft is removed atomically');

  const flaggedRecord = createRecord();
  const flagged = await execute('adminUpdateMarketplaceSubmission', flaggedRecord, {
    menu_description: 'Valid field change',
    admin_reason: 'Replace flagged file first',
    save_mode: 'PUBLISH',
  }, {
    attachments: [{
      attachment_id: 'attachment-1',
      original_name: 'expired-license.pdf',
      file_url: 'https://files.example/expired-license.pdf',
      status: 'FLAGGED',
    }],
  });
  assert.equal(flagged.error?.code, 409);
  assert.equal(flaggedRecord.menu_description, 'Original menu');
  assert.equal(flaggedRecord.saveCalls, 0);
  assert.equal(flagged.audits.length, 0);
  assert.equal(flagged.getDraft().payload.menu_description, 'Valid field change');
  assert.match(flagged.getDraft().validation_errors[0].message, /must be replaced/i);

  const awardedPriceRecord = createRecord({ bid_status: 'AWARDED' });
  const priceEdit = await execute('adminUpdateMarketplaceSubmission', awardedPriceRecord, {
    price_per_guest: 30,
    admin_reason: 'Attempted price change',
    save_mode: 'PUBLISH',
  });
  assert.equal(priceEdit.error?.code, 409);
  assert.equal(awardedPriceRecord.price_per_guest, 25);
  assert.equal(awardedPriceRecord.saveCalls, 0);
  assert.equal(priceEdit.audits.length, 0);
  assert.equal(priceEdit.getDraft().payload.price_per_guest, 30);

  const archivedRecord = createRecord({ archived_at: new Date('2026-08-19T12:00:00Z') });
  const archivedEdit = await execute('adminUpdateMarketplaceSubmission', archivedRecord, {
    menu_description: 'Attempted revival',
    admin_reason: 'Should be rejected',
    save_mode: 'PUBLISH',
  });
  assert.equal(archivedEdit.error?.code, 409);
  assert.equal(archivedRecord.saveCalls, 0);
  assert.equal(archivedEdit.audits.length, 0);

  const openRecord = createRecord();
  const withdrawn = await execute('adminMarketplaceSubmissionAction', openRecord, {
    action: 'WITHDRAW', reason: 'Vendor requested withdrawal',
  });
  assert.equal(withdrawn.error, undefined);
  assert.equal(openRecord.bid_status, 'WITHDRAWN');
  assert.equal(openRecord.withdrawn_by_user_id, 'admin-1');
  assert.equal(openRecord.saveCalls, 1);
  assert.equal(withdrawn.attachmentUpdates.length, 0, 'withdrawal retains submission files');
  assert.equal(withdrawn.audits[0].action, 'WITHDRAW_SUBMISSION');

  const repeated = await execute('adminMarketplaceSubmissionAction', openRecord, {
    action: 'WITHDRAW', reason: 'Repeated request',
  });
  assert.equal(repeated.error, undefined);
  assert.equal(openRecord.saveCalls, 1, 'repeated withdrawal is idempotent');
  assert.equal(repeated.audits.length, 0);

  const awardedRecord = createRecord({ bid_status: 'AWARDED' });
  const revoked = await execute('adminMarketplaceSubmissionAction', awardedRecord, {
    action: 'REVOKE', reason: 'Vendor did not appear',
  });
  assert.equal(revoked.error, undefined);
  assert.equal(awardedRecord.bid_status, 'REVOKED');
  assert.equal(awardedRecord.award_revoked_reason, 'Vendor did not appear');
  assert.equal(revoked.paymentUpdates.length, 1, 'pending final payment is cancelled');
  assert.equal(revoked.audits[0].action, 'REVOKE_SUBMISSION');

  const paidAward = createRecord({ bid_status: 'AWARDED' });
  const blockedRevoke = await execute('adminMarketplaceSubmissionAction', paidAward, {
    action: 'REVOKE', reason: 'Too late to revoke',
  }, { finalPayment: { payment_status: 'PAID' } });
  assert.equal(blockedRevoke.error?.code, 409);
  assert.equal(paidAward.bid_status, 'AWARDED');
  assert.equal(paidAward.saveCalls, 0);
  assert.equal(blockedRevoke.paymentUpdates.length, 0);
  assert.equal(blockedRevoke.audits.length, 0);

  const deletableRecord = createRecord();
  const deleted = await execute('adminMarketplaceSubmissionAction', deletableRecord, {
    action: 'DELETE', reason: 'Duplicate test submission',
  });
  assert.equal(deleted.error, undefined);
  assert.ok(deletableRecord.deleted_at);
  assert.equal(deleted.attachmentUpdates.length, 1);
  assert.equal(deleted.attachmentUpdates[0].update.status, 'DELETED');
  assert.equal(deleted.audits[0].action, 'DELETE_SUBMISSION');

  const replaceableRecord = createRecord({
    menu_pdf_url: 'https://files.example/old-menu.pdf',
    menu_pdf_key: 'marketplace/old-menu.pdf',
  });
  const replaceableAttachment = {
    attachment_id: 'attachment-1',
    event_id: 'event-1',
    bid_id: 'bid-1',
    attachment_type: 'BID_MENU_PDF',
    file_url: 'https://files.example/old-menu.pdf',
    file_key: 'marketplace/old-menu.pdf',
    status: 'ACTIVE',
    saveCalls: 0,
    async save() { this.saveCalls += 1; },
    toObject() { return { ...this }; },
  };
  const replaced = await execute(
    'adminReplaceMarketplaceSubmissionAttachment',
    replaceableRecord,
    { admin_reason: 'Vendor supplied corrected menu' },
    {
      attachments: [replaceableAttachment],
      params: { attachmentId: 'attachment-1' },
      file: {
        originalname: 'corrected-menu.pdf',
        mimetype: 'application/pdf',
        size: 2048,
        buffer: Buffer.from('replacement'),
      },
    }
  );
  assert.equal(replaced.error, undefined);
  assert.equal(replaceableRecord.menu_pdf_url, 'https://files.example/replacement.pdf');
  assert.equal(replaceableRecord.menu_pdf_key, 'marketplace/replacement.pdf');
  assert.equal(replaceableRecord.saveCalls, 1);
  assert.equal(replaceableAttachment.status, 'ARCHIVED');
  assert.equal(replaceableAttachment.saveCalls, 1);
  assert.equal(replaced.createdAttachments.length, 1);
  assert.equal(replaced.audits[0].action, 'REPLACE_SUBMISSION_ATTACHMENT');
  assert.equal(replaced.removedObjectKeys.length, 0, 'successful replacement retains uploaded file');

  const immutableAgreement = {
    ...replaceableAttachment,
    attachment_id: 'agreement-1',
    attachment_type: 'AGREEMENT_DOCUMENT',
    status: 'ACTIVE',
  };
  const blockedAgreement = await execute(
    'adminReplaceMarketplaceSubmissionAttachment',
    createRecord(),
    { admin_reason: 'Attempted agreement replacement' },
    {
      attachments: [immutableAgreement],
      params: { attachmentId: 'agreement-1' },
      file: {
        originalname: 'agreement.pdf',
        mimetype: 'application/pdf',
        size: 2048,
        buffer: Buffer.from('agreement'),
      },
    }
  );
  assert.equal(blockedAgreement.error?.code, 409);
  assert.match(blockedAgreement.error.message, /cannot be replaced/i);
  assert.equal(blockedAgreement.createdAttachments.length, 0);

  const failedReplacementRecord = createRecord({
    menu_pdf_url: 'https://files.example/old-menu.pdf',
    menu_pdf_key: 'marketplace/old-menu.pdf',
  });
  const failedReplacementAttachment = {
    ...replaceableAttachment,
    status: 'ACTIVE',
    saveCalls: 0,
  };
  const failedReplacement = await execute(
    'adminReplaceMarketplaceSubmissionAttachment',
    failedReplacementRecord,
    { admin_reason: 'Audit failure cleanup proof' },
    {
      attachments: [failedReplacementAttachment],
      failAudit: true,
      params: { attachmentId: 'attachment-1' },
      file: {
        originalname: 'corrected-menu.pdf',
        mimetype: 'application/pdf',
        size: 2048,
        buffer: Buffer.from('replacement'),
      },
    }
  );
  assert.match(failedReplacement.error?.message || '', /audit unavailable/i);
  assert.deepEqual(
    failedReplacement.removedObjectKeys,
    ['marketplace/replacement.pdf'],
    'a failed transaction removes the newly uploaded object'
  );

  console.log('marketplace admin submission controller tests passed');
})().catch((error) => {
  Module._load = originalLoad;
  console.error(error);
  process.exitCode = 1;
});
