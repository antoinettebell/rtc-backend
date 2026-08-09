const EMPLOYEE_ASSIGNED_LOCATION_CLOSED_MESSAGE =
  'Your assigned location is closed. Open this location before taking orders.';

const idsMatch = (left, right) =>
  !!left && !!right && left.toString() === right.toString();

const isAssignedEmployeeLocationOpen = ({
  foodTruck,
  assignedTruckUnitId,
  assignedLocationId,
}) => {
  if (!foodTruck || !assignedTruckUnitId || !assignedLocationId) {
    return false;
  }

  const assignedTruckUnit = (foodTruck.truck_units || []).find(
    (unit) => idsMatch(unit?._id, assignedTruckUnitId) && !unit?.is_archived
  );

  if (!assignedTruckUnit) {
    return false;
  }

  return (assignedTruckUnit.open_locations || []).some(
    (location) =>
      idsMatch(location?.locationId || location?.location_id, assignedLocationId) &&
      location?.isOrderingOpen === true
  );
};

const assertAssignedEmployeeLocationOpen = (context) => {
  if (isAssignedEmployeeLocationOpen(context)) return;
  const error = new Error(EMPLOYEE_ASSIGNED_LOCATION_CLOSED_MESSAGE);
  error.code = 403;
  throw error;
};

const isEmployeeOrderOperation = ({ originalUrl = '' }) =>
  originalUrl.startsWith('/api/v1/order') ||
  originalUrl.startsWith('/api/v1/vendor-employee/orders') ||
  originalUrl.startsWith('/api/v1/vendor-employee/refund-cancel-requests');

module.exports = {
  EMPLOYEE_ASSIGNED_LOCATION_CLOSED_MESSAGE,
  assertAssignedEmployeeLocationOpen,
  isAssignedEmployeeLocationOpen,
  isEmployeeOrderOperation,
};
