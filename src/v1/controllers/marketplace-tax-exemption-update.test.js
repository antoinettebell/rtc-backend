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
  status: 'AWARDED',
  event_name: 'Approved charitable event',
  event_type: 'PRIVATE_EVENT',
  event_visibility: 'PRIVATE',
  ticket_sales_enabled: false,
  fully_catered_event: true,
  event_description: 'Before edit',
  primary_service_style: 'FOOD_TRUCK',
  service_types: ['FOOD_TRUCK'],
  service_styles: ['FOOD_TRUCK'],
  event_date: '2027-09-24',
  event_time: '18:00',
  event_duration_minutes: 120,
  event_close_date: new Date('2027-09-23T22:00:00.000Z'),
  event_address: '123 Main Street',
  event_city: 'Columbia',
  event_state: 'SC',
  number_of_guests: 50,
  free_food_offered: false,
  payment_responsibility: 'CUSTOMER',
  budgeted_amount: 2000,
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
    console.log('Marketplace awarded-event edit and exemption preservation test passed.');
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
