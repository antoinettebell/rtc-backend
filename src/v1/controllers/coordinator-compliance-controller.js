const { docusign } = require('../../config');
const { addObjectFromBufferWithKey } = require('../../helper/aws');
const DocuSignHelper = require('../../helper/docusign-helper');
const {
  CoordinatorComplianceW9EnvelopeModel,
  UserModel,
} = require('../../models');

const buildError = (message, code = 400) => Object.assign(new Error(message), { code });

const getCoordinator = async (user) => {
  const coordinator = await UserModel.findById(user._id);
  if (!coordinator || user.userType !== 'CUSTOMER' || !coordinator.isEventCoordinator) {
    throw buildError('Only enabled event coordinators can manage coordinator compliance.', 403);
  }
  return coordinator;
};

const requiresPayoutCompliance = (coordinator) =>
  coordinator.eventCoordinatorExpectsTicketSales === true ||
  coordinator.eventCoordinatorExpectsVendorFees === true;

const toSafeSession = (session) => {
  if (!session) return null;
  const value = typeof session.toObject === 'function' ? session.toObject() : session;
  return {
    session_id: value.session_id,
    envelope_id: value.envelope_id,
    status: value.status,
    verification_status: value.verification_status,
    completed_at: value.completed_at,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
};

exports.status = async (req, res, next) => {
  try {
    const coordinator = await getCoordinator(req.user);
    const session = await CoordinatorComplianceW9EnvelopeModel.findOne({
      coordinator_user_id: coordinator._id,
    }).sort({ created_at: -1 });
    return res.data({
      payout_eligibility: coordinator.eventCoordinatorPayoutEligibility,
      requires_payout_compliance: requiresPayoutCompliance(coordinator),
      w9_session: toSafeSession(session),
    }, 'Coordinator compliance status');
  } catch (error) {
    return next(error);
  }
};

exports.startW9Signing = async (req, res, next) => {
  try {
    const coordinator = await getCoordinator(req.user);
    if (!requiresPayoutCompliance(coordinator)) {
      throw buildError('Enable ticket sales or vendor-fee payouts before signing a W-9.', 409);
    }
    if (!coordinator.eventCoordinatorTaxIdEncrypted || !coordinator.eventCoordinatorTaxIdMasked) {
      throw buildError('Add your EIN or SSN to the coordinator profile before signing a W-9.', 409);
    }

    const signerName = [coordinator.firstName, coordinator.lastName]
      .filter(Boolean)
      .join(' ')
      .trim() || coordinator.eventCoordinatorCompanyName || 'Event Coordinator';
    const envelope = await DocuSignHelper.createVendorComplianceW9Envelope({
      vendorName: signerName,
      vendorEmail: coordinator.email,
      vendorUserId: coordinator._id,
    });
    const envelopeId = String(envelope?.envelopeId || envelope?.envelope_id || '').trim();
    if (!envelopeId) throw new Error('DocuSign did not create a W-9 signing session.');

    const recipients = await DocuSignHelper.getEnvelopeRecipients(envelopeId);
    const signer = (recipients?.signers || []).find(
      (item) => String(item?.clientUserId || '') === String(coordinator._id)
    );
    if (!signer?.recipientId) throw new Error('DocuSign did not return the W-9 signer.');
    const view = await DocuSignHelper.createRecipientView({
      envelopeId,
      signerName,
      signerEmail: coordinator.email,
      vendorUserId: coordinator._id,
      recipientId: signer.recipientId,
      returnUrl: docusign.customerReturnUrl,
    });
    const session = await CoordinatorComplianceW9EnvelopeModel.create({
      coordinator_user_id: coordinator._id,
      envelope_id: envelopeId,
      verification_status: 'PENDING',
    });
    return res.data({
      envelope_id: envelopeId,
      signing_url: view?.url,
      w9_session: toSafeSession(session),
    }, 'Coordinator W-9 signing started');
  } catch (error) {
    return next(error);
  }
};

exports.completeW9Signing = async (req, res, next) => {
  try {
    const coordinator = await getCoordinator(req.user);
    const envelopeId = String(req.body?.envelope_id || '').trim();
    if (!envelopeId) throw buildError('W-9 signing session is required.');
    const session = await CoordinatorComplianceW9EnvelopeModel.findOne({
      coordinator_user_id: coordinator._id,
      envelope_id: envelopeId,
    });
    if (!session) throw buildError('Coordinator W-9 signing session not found.', 404);
    if (session.signed_document_key) {
      return res.data({ w9_session: toSafeSession(session), pending_verification: true }, 'W-9 is already awaiting verification');
    }

    const envelope = await DocuSignHelper.getEnvelopeStatus(envelopeId);
    const status = String(envelope?.status || '').toLowerCase();
    if (status !== 'completed') {
      session.status = status === 'declined' ? 'DECLINED' : status === 'voided' ? 'VOIDED' : 'SENT';
      await session.save();
      throw buildError('DocuSign has not confirmed the completed W-9 signature.', 409);
    }

    const pdfBuffer = await DocuSignHelper.downloadEnvelopeDocuments(envelopeId);
    const { url, key } = await addObjectFromBufferWithKey(
      {
        buffer: pdfBuffer,
        originalname: `signed-coordinator-w9-${envelopeId}.pdf`,
        mimetype: 'application/pdf',
      },
      `coordinator-compliance/${coordinator._id}/W9`
    );
    session.status = 'SIGNED';
    session.signed_document_url = url;
    session.signed_document_key = key;
    session.verification_status = 'PENDING';
    session.completed_at = new Date();
    session.error_message = null;
    await session.save();

    return res.data({ w9_session: toSafeSession(session), pending_verification: true }, 'Signed coordinator W-9 received and awaiting verification');
  } catch (error) {
    return next(error);
  }
};
