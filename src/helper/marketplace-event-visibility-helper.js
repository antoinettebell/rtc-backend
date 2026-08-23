const {
	buildEventVendorRequirementSummary,
} = require('./marketplace-submission-lifecycle');
const {
	getMarketplaceFilledSlotSummary,
	getMarketplaceServiceRequirements,
	getMarketplaceVendorCapacity,
} = require('./marketplace-participation-helper');

const FOOD_APPLICATION_FILLED_STATUSES = ['ACCEPTED', 'PAYMENT_DUE', 'PAID', 'CONFIRMED'];
const FOOD_VENDOR_SERVICE_TYPES = new Set([
	'food truck',
	'full service catering',
	'buffet',
	'drop off catering',
	'served stations',
	'beverage and alcohol',
	'beverage alcohol service',
	'alcohol',
]);
const FOOD_VENDOR_SERVICE_STYLES = new Set([
	'plated',
	'buffet',
	'food truck',
	'family style stations',
]);

const normalizeServiceValue = (value) => String(value || '')
	.trim()
	.toLowerCase()
	.replace(/&/g, ' and ')
	.replace(/[^a-z0-9]+/g, ' ')
	.replace(/\s+/g, ' ')
	.trim();

const asServiceValues = (value) => (Array.isArray(value) ? value : [value])
	.map(normalizeServiceValue)
	.filter(Boolean);

const isFoodVendorMarketplaceEvent = (event = {}) => {
	if (Number(event.number_of_vendors_needed || 0) <= 0) return false;
	const serviceTypes = [
		...asServiceValues(event.service_type),
		...asServiceValues(event.service_types),
	];
	const serviceStyles = [
		...asServiceValues(event.service_styles),
		...asServiceValues(event.primary_service_style),
	];
	return serviceTypes.some((value) => FOOD_VENDOR_SERVICE_TYPES.has(value)) ||
		serviceStyles.some((value) => FOOD_VENDOR_SERVICE_STYLES.has(value));
};

const getAllowedMarketplaceVendorCount = (event = {}) => {
	const requested = Number(event.number_of_vendors_needed);
	if (!isFoodVendorMarketplaceEvent({ ...event, number_of_vendors_needed: requested || 1 })) {
		return Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : 1);
	}
	const { calculatedMaximum } = getMarketplaceVendorCapacity(event);
	return Number.isFinite(requested)
		? Math.max(1, Math.min(Math.floor(requested), calculatedMaximum))
		: calculatedMaximum;
};

const hasFoodVendorAwardCapacity = ({ event = {}, bids = [], applications = [] }) => {
	const requestedVendorCount = Math.max(0, Number(event.number_of_vendors_needed || 0));
	if (!requestedVendorCount) return false;

	const { gaRequirement, vipRequirement, dessertRequirement, drinksRequirement } = getMarketplaceServiceRequirements(
		event,
		requestedVendorCount
	);
	const filled = getMarketplaceFilledSlotSummary({
		bids,
		applications,
		separateVipVendorRequired: event.separate_vip_vendor_required,
		gaRequirement,
		vipRequirement,
		dessertRequirement,
		drinksRequirement,
	});
	return filled.remainingTotalServiceSlots > 0;
};

const hasMarketplaceVendorAwardCapacity = ({ event = {}, profileTypes = [], applications = [] }) => {
	const summary = buildEventVendorRequirementSummary({
		needs: event.event_vendor_needs || [],
		applications,
	});
	const approvedTypes = new Set((profileTypes || []).map((type) => String(type).toUpperCase()));
	return summary.some(
		(need) => approvedTypes.has(need.vendor_type) && Number(need.remaining || 0) > 0
	);
};

const hasMarketplaceVendorCapacityForRequestedTypes = ({
	event = {},
	requestedTypes = [],
	approvedTypes = [],
	applications = [],
}) => {
	const normalizedRequestedTypes = [...new Set(
		(requestedTypes || []).map((type) => String(type || '').trim().toUpperCase()).filter(Boolean)
	)];
	if (!normalizedRequestedTypes.length) return false;
	const approved = new Set(
		(approvedTypes || []).map((type) => String(type || '').trim().toUpperCase()).filter(Boolean)
	);
	const summary = buildEventVendorRequirementSummary({
		needs: event.event_vendor_needs || [],
		applications,
	});
	return normalizedRequestedTypes.every((requestedType) => {
		const requirement = summary.find((item) => item.vendor_type === requestedType);
		return approved.has(requestedType) &&
			Number((requirement && requirement.requested) || 0) > 0 &&
			Number((requirement && requirement.remaining) || 0) > 0;
	});
};

module.exports = {
	FOOD_APPLICATION_FILLED_STATUSES,
	isFoodVendorMarketplaceEvent,
	getAllowedMarketplaceVendorCount,
	hasFoodVendorAwardCapacity,
	hasMarketplaceVendorAwardCapacity,
	hasMarketplaceVendorCapacityForRequestedTypes,
};
