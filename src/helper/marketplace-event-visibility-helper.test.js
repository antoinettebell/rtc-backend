const assert = require('assert');
const {
	hasFoodVendorAwardCapacity,
	hasMarketplaceVendorAwardCapacity,
	hasMarketplaceVendorCapacityForRequestedTypes,
	isFoodVendorMarketplaceEvent,
	getAllowedMarketplaceVendorCount,
} = require('./marketplace-event-visibility-helper');

assert.equal(getAllowedMarketplaceVendorCount({
	service_types: ['Food Truck'],
	number_of_guests: 50,
	number_of_vendors_needed: 2,
}), 1, 'a crafted request cannot increase Food Vendor capacity above the guest calculation');
assert.equal(getAllowedMarketplaceVendorCount({
	primary_service_style: 'Plated',
	number_of_guests: 250,
	number_of_vendors_needed: 2,
}), 2, 'canonical catering styles use the same guest calculation');
assert.equal(getAllowedMarketplaceVendorCount({
	service_types: ['Food Truck'],
	number_of_guests: 250,
	number_of_vendors_needed: 1,
}), 1, 'the coordinator may reduce the calculated count but not below one');

const foodEvent = {
	number_of_vendors_needed: 2,
	number_of_guests: 200,
	status: 'OPEN',
};

// Jazzy Fried Rice's own submitted bid does not consume Pizza House's opportunity.
assert.equal(hasFoodVendorAwardCapacity({
	event: foodEvent,
	bids: [{ vendor_user_id: 'jazzy', bid_status: 'SUBMITTED' }],
	applications: [],
}), true);
assert.equal(hasFoodVendorAwardCapacity({
	event: foodEvent,
	bids: [{ vendor_user_id: 'jazzy', bid_status: 'AWARDED' }],
	applications: [],
}), true);
assert.equal(hasFoodVendorAwardCapacity({
	event: foodEvent,
	bids: [
		{ vendor_user_id: 'jazzy', bid_status: 'AWARDED', guest_coverage: 'REGULAR' },
		{ vendor_user_id: 'pizza-house', bid_status: 'AWARDED', guest_coverage: 'REGULAR' },
	],
	applications: [],
}), false);

const eventVendorEvent = {
	event_vendor_needs: [
		{ vendor_type: 'MERCHANDISE', quantity: 2 },
		{ vendor_type: 'SERVICE', quantity: 1 },
	],
};
assert.equal(hasMarketplaceVendorAwardCapacity({
	event: eventVendorEvent,
	profileTypes: ['MERCHANDISE'],
	applications: [{ application_id: 'jazzy-merch', status: 'SUBMITTED', vendor_types: ['MERCHANDISE'] }],
}), true);
assert.equal(hasMarketplaceVendorAwardCapacity({
	event: eventVendorEvent,
	profileTypes: ['MERCHANDISE'],
	applications: [
		{ application_id: 'merch-one', status: 'PAID', vendor_types: ['MERCHANDISE'] },
		{ application_id: 'merch-two', status: 'AWARDED', vendor_types: ['MERCHANDISE'] },
	],
}), false);
assert.equal(hasMarketplaceVendorAwardCapacity({
	event: eventVendorEvent,
	profileTypes: ['SERVICE'],
	applications: [
		{ application_id: 'merch-one', status: 'PAID', vendor_types: ['MERCHANDISE'] },
		{ application_id: 'merch-two', status: 'AWARDED', vendor_types: ['MERCHANDISE'] },
	],
}), true);

const canonicalFoodServiceTypes = [
	'Food Truck',
	'Full Service Catering',
	'Buffet',
	'Drop-off Catering',
	'Served Stations',
	'Beverage and Alcohol',
];
canonicalFoodServiceTypes.forEach((serviceType) => assert.equal(
	isFoodVendorMarketplaceEvent({ service_types: [serviceType], number_of_vendors_needed: 1 }),
	true,
	`${serviceType} is a canonical Food Vendor Marketplace service`
));
for (const primaryServiceStyle of ['Plated', 'Buffet', 'Food Truck', 'Family Style / Stations']) {
	assert.equal(isFoodVendorMarketplaceEvent({ primary_service_style: primaryServiceStyle, number_of_vendors_needed: 1 }), true);
}
assert.equal(isFoodVendorMarketplaceEvent({ service_type: 'Full-Service Catering', number_of_vendors_needed: 1 }), true);
assert.equal(isFoodVendorMarketplaceEvent({ service_types: ['Beverage/Alcohol Service'], number_of_vendors_needed: 1 }), true);
assert.equal(isFoodVendorMarketplaceEvent({ service_type: 'Alcohol', number_of_vendors_needed: 1 }), true);
assert.equal(isFoodVendorMarketplaceEvent({
	service_type: 'Food Truck',
	service_types: ['Photography'],
	number_of_vendors_needed: 1,
}), true, 'legacy service_type remains authoritative when service_types is also populated');
assert.equal(isFoodVendorMarketplaceEvent({
	service_types: ['Photography'],
	primary_service_style: 'Other',
	number_of_vendors_needed: 2,
	event_vendor_needs: [{ vendor_type: 'SERVICE', quantity: 2 }],
}), false, 'Marketplace-Vendor-only needs do not qualify as food service');
assert.equal(isFoodVendorMarketplaceEvent({
	service_types: ['Other'],
	primary_service_style: 'Other',
	alcohol_required: true,
	permits: ['Alcohol'],
	number_of_vendors_needed: 1,
}), false, 'alcohol flags and permits alone do not qualify an event for Food Vendors');
assert.equal(isFoodVendorMarketplaceEvent({ service_types: ['Food Truck'], number_of_vendors_needed: 0 }), false);

const merchandiseFullServiceOpen = [
	{ application_id: 'merch-one', status: 'PAID', vendor_types: ['MERCHANDISE'] },
	{ application_id: 'merch-two', status: 'AWARDED', vendor_types: ['MERCHANDISE'] },
];
assert.equal(hasMarketplaceVendorCapacityForRequestedTypes({
	event: eventVendorEvent,
	requestedTypes: ['MERCHANDISE'],
	approvedTypes: ['MERCHANDISE', 'SERVICE'],
	applications: merchandiseFullServiceOpen,
}), false, 'an open Service category cannot authorize a full Merchandise request');
assert.equal(hasMarketplaceVendorCapacityForRequestedTypes({
	event: eventVendorEvent,
	requestedTypes: ['SERVICE'],
	approvedTypes: ['MERCHANDISE', 'SERVICE'],
	applications: merchandiseFullServiceOpen,
}), true);
assert.equal(hasMarketplaceVendorCapacityForRequestedTypes({
	event: eventVendorEvent,
	requestedTypes: ['MERCHANDISE', 'SERVICE'],
	approvedTypes: ['MERCHANDISE', 'SERVICE'],
	applications: merchandiseFullServiceOpen,
}), false, 'every explicitly requested category must have capacity');
assert.equal(hasMarketplaceVendorCapacityForRequestedTypes({
	event: eventVendorEvent,
	requestedTypes: ['OTHER'],
	approvedTypes: ['OTHER'],
	applications: [],
}), false, 'an unrequested category cannot be authorized');

console.log('marketplace event visibility tests passed');
