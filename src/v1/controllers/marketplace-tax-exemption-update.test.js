const assert = require('assert');
const {
  MarketplaceApplicationService,
  MarketplaceBidService,
  MarketplaceEventService,
  UserService,
} = require('../services');
const MarketplaceController = require('./marketplace-controller');

const originalMethods = {
  userGetById: UserService.getById,
  eventGetByData: MarketplaceEventService.getByData,
  eventUpdate: MarketplaceEventService.update,
  eventGetWithImages: MarketplaceEventService.getWithImages,
  bidGetModel: MarketplaceBidService.getModel,
  applicationGetModel: MarketplaceApplicationService.getModel,
  bidGetByData: MarketplaceBidService.getByData,
  applicationGetByData: MarketplaceApplicationService.getByData,
};

const approvedEvent = {
  event_id: 'event-tax-edit',
  customer_user_id: 'customer-tax-edit',
  status: 'DRAFT',
  event_name: 'Approved charitable event',
  event_type: 'PRIVATE_EVENT',
  event_visibility: 'PRIVATE',
  event_description: 'Before edit',
  charitable_event: true,
  religious_organization: false,
  tax_exemption_status: 'APPROVED',
  tax_exemption_entity_use_code: 'E',
  tax_exemption_certificate_url: 'https://files/certificate.pdf',
  event_vendor_needs: [],
  service_types: [],
  service_styles: [],
  equipment_needed: [],
  permits_required: [],
  toObject() {
    return { ...this, toObject: undefined };
  },
};

let capturedUpdate;

const run = async () => {
  try {
    UserService.getById = async () => ({
      isEventCoordinator: true,
      eventCoordinatorTaxIdEncrypted: 'encrypted-tax-id',
    });
    MarketplaceEventService.getByData = async () => approvedEvent;
    MarketplaceEventService.update = async (_query, update) => {
      capturedUpdate = update;
      return { ...approvedEvent, ...update };
    };
    MarketplaceEventService.getWithImages = async () => ({
      ...approvedEvent,
      ...capturedUpdate,
    });
    MarketplaceBidService.getModel = () => ({ updateMany: async () => ({}) });
    MarketplaceApplicationService.getModel = () => ({ updateMany: async () => ({}) });
    MarketplaceBidService.getByData = async () => [];
    MarketplaceApplicationService.getByData = async () => [];

    let responsePayload;
    let controllerError;
    await MarketplaceController.updateEvent(
      {
        user: { _id: 'customer-tax-edit', userType: 'CUSTOMER' },
        params: { eventId: 'event-tax-edit' },
        body: { event_description: 'After unrelated edit' },
      },
      {
        data(payload) {
          responsePayload = payload;
          return payload;
        },
      },
      (error) => {
        controllerError = error;
      }
    );

    assert.ifError(controllerError);
    assert.equal(capturedUpdate.charitable_event, true);
    assert.equal(capturedUpdate.religious_organization, false);
    assert.equal(capturedUpdate.tax_exemption_status, 'APPROVED');
    assert.equal(capturedUpdate.tax_exemption_entity_use_code, 'E');
    assert.equal(
      capturedUpdate.tax_exemption_certificate_url,
      approvedEvent.tax_exemption_certificate_url
    );
    assert.equal(
      responsePayload.marketplaceEvent.event_description,
      'After unrelated edit'
    );
    console.log('Marketplace controller unrelated-edit exemption preservation test passed.');
  } finally {
    UserService.getById = originalMethods.userGetById;
    MarketplaceEventService.getByData = originalMethods.eventGetByData;
    MarketplaceEventService.update = originalMethods.eventUpdate;
    MarketplaceEventService.getWithImages = originalMethods.eventGetWithImages;
    MarketplaceBidService.getModel = originalMethods.bidGetModel;
    MarketplaceApplicationService.getModel = originalMethods.applicationGetModel;
    MarketplaceBidService.getByData = originalMethods.bidGetByData;
    MarketplaceApplicationService.getByData = originalMethods.applicationGetByData;
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
