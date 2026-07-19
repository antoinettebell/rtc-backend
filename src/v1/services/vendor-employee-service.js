const {
  OrderModel,
  UserModel,
  VendorEmployeeModel: Model,
} = require('../../models');
const { BaseService } = require('../../common-services');
const FoodTruckService = require('./food-truck-service');
const PlanService = require('./plan-service');
const EncryptionService = require('../../helper/encryption');
const { maskTaxId } = require('../../helper/event-coordinator-profile');
const {
  assertVendorPlanCapability,
  getVendorPlanCapabilities,
} = require('../../helper/vendor-plan-helper');

const buildError = (message, code = 409) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const completedSalesStatuses = ['COMPLETED', 'DELIVERED'];
const getTruckUnitId = (unit) => unit?._id?.toString();
const toSafeEmployee = (employee) => {
  const safeEmployee =
    typeof employee?.toObject === 'function' ? employee.toObject() : employee;
  if (safeEmployee) {
    delete safeEmployee.pin_hash;
  }
  return safeEmployee;
};

const normalizeEmployeeRate = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const employeeRatesMatch = (left, right) =>
  normalizeEmployeeRate(left) === normalizeEmployeeRate(right);
const employeeProfileFields = [
  'first_name',
  'last_name',
  'zip_code',
  'phone_number',
  'address_line1',
  'address_city',
  'address_state',
  'address_zip',
  'employee_id_photo_url',
  'employee_tax_identifier_type',
  'employee_tax_identifier_masked',
];
const normalizeEmployeeProfileValue = (value) =>
  value === null || value === undefined ? '' : String(value).trim();
const employeeProfileValuesMatch = (left, right) =>
  normalizeEmployeeProfileValue(left) === normalizeEmployeeProfileValue(right);
const buildEmployeeProfileSnapshot = (source) =>
  employeeProfileFields.reduce((snapshot, field) => {
    snapshot[field] = source?.[field] ?? null;
    return snapshot;
	  }, {});

const normalizeTaxIdType = (value) => {
  const normalized = String(value || '').toUpperCase();
  return normalized === 'SSN' ? 'SSN' : 'EIN';
};

const taxDigits = (value) => String(value || '').replace(/\D/g, '').slice(0, 9);

const buildEmployeeTaxUpdate = ({ type, value }) => {
  if (value === undefined) {
    return null;
  }

  const digits = taxDigits(value);
  if (!digits) {
    return {
      employee_tax_identifier_type: null,
      employee_tax_identifier_encrypted: null,
      employee_tax_identifier_masked: null,
    };
  }

  if (digits.length !== 9) {
    throw buildError('Employee EIN/SSN must be 9 digits.', 400);
  }

  const taxType = normalizeTaxIdType(type);
  return {
    employee_tax_identifier_type: taxType,
    employee_tax_identifier_encrypted: EncryptionService.encrypt(digits),
    employee_tax_identifier_masked: maskTaxId(digits, taxType),
  };
};

class VendorEmployeeService extends BaseService {
  constructor() {
    super(Model);
  }

  async generateUniqueEmployeeLoginId({
    food_truck_id,
    first_name,
    last_name,
    zip_code,
  }) {
    const baseLoginId = Model.formatEmployeeLoginId({
      first_name,
      last_name,
      zip_code,
    });

    if (!baseLoginId) {
      throw buildError('Employee login ID could not be generated.', 400);
    }

    let employee_login_id = baseLoginId;
    let suffix = 2;

    while (
      await Model.exists({
        food_truck_id,
        employee_login_id,
      })
    ) {
      employee_login_id = `${baseLoginId}-${suffix}`;
      suffix += 1;
    }

    return employee_login_id;
  }

  async createForVendor({
    vendor_user_id,
    food_truck_id,
    assigned_location_id,
    assigned_truck_unit_id = null,
    first_name,
    last_name,
    zip_code,
    phone_number = null,
    address_line1 = null,
    address_city = null,
    address_state = null,
    address_zip = null,
	    employee_id_photo_url,
	    employee_tax_identifier_type = null,
	    employee_tax_identifier = undefined,
	    pin,
    ...rest
  }) {
    const foodTruck = await FoodTruckService.getByData(
      {
        _id: food_truck_id,
        userId: vendor_user_id,
      },
      { singleResult: true }
    );

    if (!foodTruck) {
      throw buildError('Food truck not found or access denied.', 404);
    }

    const locationExists = (foodTruck.locations || []).some(
      (location) => location._id?.toString() === assigned_location_id?.toString()
    );

    if (!locationExists) {
      throw buildError('Employee must be assigned to an existing location.');
    }

    const assignedTruckUnit = this.getAssignedTruckUnit(
      foodTruck,
      assigned_truck_unit_id
    );

    if (!pin) {
      throw buildError('Employee PIN is required.');
    }

    if (!employee_id_photo_url) {
      throw buildError('Employee ID photo is required.', 400);
    }

    const employee_login_id = await this.generateUniqueEmployeeLoginId({
      food_truck_id,
      first_name,
      last_name,
      zip_code,
    });

	    const taxUpdate = buildEmployeeTaxUpdate({
	      type: employee_tax_identifier_type,
	      value: employee_tax_identifier,
	    });

	    return this.create({
      ...rest,
      vendor_user_id,
      food_truck_id,
      assigned_location_id,
      assigned_truck_unit_id: assignedTruckUnit._id,
	      assigned_truck_unit_name: assignedTruckUnit.name,
      first_name,
	      last_name,
      zip_code,
      phone_number,
      address_line1,
      address_city,
      address_state,
      address_zip,
	      employee_id_photo_url,
	      employee_id_photo_uploaded_at: new Date(),
	      ...(taxUpdate || {}),
	      employee_login_id,
      pin_hash: pin,
      employee_rate: normalizeEmployeeRate(rest.employee_rate),
    });
  }

  buildEmployeeListQuery({
    vendor_user_id,
    food_truck_id = null,
    includeArchived = false,
    archivedOnly = false,
  }) {
    const q = { vendor_user_id };

    if (food_truck_id) {
      q.food_truck_id = food_truck_id;
    }

    if (archivedOnly) {
      q.is_archived = true;
    } else if (!includeArchived) {
      q.is_archived = false;
    }

    return q;
  }

  async listForVendor({
    vendor_user_id,
    food_truck_id = null,
    includeArchived = false,
    archivedOnly = false,
  }) {
    return this.getByData(
      this.buildEmployeeListQuery({
        vendor_user_id,
        food_truck_id,
        includeArchived,
        archivedOnly,
      }),
      {
        sort: { is_archived: 1, created_at: -1 },
      }
    );
  }

  async getVendorFoodTruck(vendorUserId, foodTruckId) {
    const foodTruck = await FoodTruckService.getByData(
      {
        _id: foodTruckId,
        userId: vendorUserId,
      },
      { singleResult: true }
    );

    if (!foodTruck) {
      throw buildError('Food truck not found or access denied.', 404);
    }

    return foodTruck;
  }

  async getVendorFoodTruckByUser(vendorUserId) {
    const foodTruck = await FoodTruckService.getByData(
      { userId: vendorUserId },
      { singleResult: true }
    );

    if (!foodTruck) {
      throw buildError('Food truck not found or access denied.', 404);
    }

    return foodTruck;
  }

  assertExistingLocation(foodTruck, assignedLocationId) {
    const locationExists = (foodTruck.locations || []).some(
      (location) => location._id?.toString() === assignedLocationId?.toString()
    );

    if (!locationExists) {
      throw buildError('Employee must be assigned to an existing location.');
    }
  }

  getAssignedTruckUnit(foodTruck, assignedTruckUnitId = null) {
    const units = foodTruck.truck_units || [];
    if (!units.length && !assignedTruckUnitId) {
      return {
        _id: null,
        name: foodTruck.name || 'Truck 1',
      };
    }

    const unit =
      (assignedTruckUnitId
        ? units.find(
            (item) => getTruckUnitId(item) === assignedTruckUnitId?.toString()
          )
        : units.find((item) => item.is_primary && !item.is_archived)) ||
      units.find((item) => !item.is_archived);

    if (!unit || unit.is_archived) {
      throw buildError('Employee must be assigned to an active truck name.');
    }

    return unit;
  }

  async getScopedEmployee({
    vendor_user_id,
    employee_id,
    includeArchived = false,
  }) {
    const q = {
      _id: employee_id,
      vendor_user_id,
    };

    if (!includeArchived) {
      q.is_archived = false;
    }

    const employee = await this.getByData(
      q,
      { singleResult: true }
    );

    if (!employee) {
      throw buildError('Employee not found.', 404);
    }

    return employee;
  }

  async updateForVendor({ vendor_user_id, employee_id, update, actor_user_id = vendor_user_id }) {
    const employee = await this.getScopedEmployee({ vendor_user_id, employee_id });
    let assignedLocationChanged = false;

    if (!employee.employee_id_photo_url && !update.employee_id_photo_url) {
      throw buildError('Employee ID photo is required before saving employee changes.', 400);
    }

    if (update.assigned_location_id || update.assigned_truck_unit_id) {
      const foodTruck = await this.getVendorFoodTruck(
        vendor_user_id,
        employee.food_truck_id
      );
      const nextLocationId =
        update.assigned_location_id || employee.assigned_location_id;
      this.assertExistingLocation(foodTruck, nextLocationId);
      const assignedTruckUnit = this.getAssignedTruckUnit(
        foodTruck,
        update.assigned_truck_unit_id || employee.assigned_truck_unit_id
      );
      assignedLocationChanged =
        employee.assigned_location_id?.toString() !==
          nextLocationId?.toString() ||
        employee.assigned_truck_unit_id?.toString() !==
          assignedTruckUnit._id?.toString();
      employee.assigned_location_id = nextLocationId;
      employee.assigned_truck_unit_id = assignedTruckUnit._id;
      employee.assigned_truck_unit_name = assignedTruckUnit.name;
    }

	    const taxUpdate = buildEmployeeTaxUpdate({
	      type: update.employee_tax_identifier_type || employee.employee_tax_identifier_type,
	      value: update.employee_tax_identifier,
	    });
	    if (taxUpdate) {
	      Object.assign(update, taxUpdate);
	      delete update.employee_tax_identifier;
	    }

	    const previousProfile = buildEmployeeProfileSnapshot(employee);
    let profileChanged = false;

    employeeProfileFields.forEach((field) => {
      if (update[field] !== undefined) {
        if (!employeeProfileValuesMatch(employee[field], update[field])) {
          profileChanged = true;
        }
        employee[field] = update[field];
      }
    });

    if (profileChanged) {
      employee.profile_history = [
        ...(employee.profile_history || []),
        {
          previous: previousProfile,
          next: buildEmployeeProfileSnapshot(employee),
          changed_at: new Date(),
          changed_by_user_id: actor_user_id,
        },
      ];
    }

    if (
      update.employee_id_photo_url !== undefined &&
      !employeeProfileValuesMatch(
        previousProfile.employee_id_photo_url,
        update.employee_id_photo_url
      )
    ) {
      employee.employee_id_photo_history = [
        ...(employee.employee_id_photo_history || []),
        {
          previous_url: previousProfile.employee_id_photo_url || null,
          new_url: update.employee_id_photo_url || null,
          changed_at: new Date(),
          changed_by_user_id: actor_user_id,
        },
      ];
      employee.employee_id_photo_uploaded_at = new Date();
    }

    if (
      update.employee_rate !== undefined &&
      !employeeRatesMatch(employee.employee_rate, update.employee_rate)
    ) {
      const previousRate = normalizeEmployeeRate(employee.employee_rate);
      const nextRate = normalizeEmployeeRate(update.employee_rate);
      employee.employee_rate_history = [
        ...(employee.employee_rate_history || []),
        {
          previous_rate: previousRate,
          new_rate: nextRate,
          changed_at: new Date(),
          changed_by_user_id: actor_user_id,
        },
      ];
      employee.employee_rate = nextRate;
    }

    ['is_active', 'is_working'].forEach((field) => {
      if (update[field] !== undefined) {
        employee[field] = update[field];
      }
    });

    if (assignedLocationChanged) {
      employee.is_working = false;
    }

    await employee.save();
    return employee;
  }

  async resetPinForVendor({
    vendor_user_id,
    employee_id,
    pin,
    includeArchived = false,
  }) {
    if (!pin) {
      throw buildError('Employee PIN is required.');
    }

    const employee = await this.getScopedEmployee({
      vendor_user_id,
      employee_id,
      includeArchived,
    });
    employee.pin_hash = pin;
    await employee.save();
    return toSafeEmployee(employee);
  }

  async archiveForVendor({ vendor_user_id, employee_id, actor_user_id = vendor_user_id }) {
    const employee = await this.getScopedEmployee({
      vendor_user_id,
      employee_id,
      includeArchived: true,
    });
    employee.is_active = false;
    employee.is_working = false;
    employee.is_archived = true;
    employee.terminated_at = employee.terminated_at || new Date();
    employee.terminated_by_user_id = actor_user_id || vendor_user_id;
    await employee.save();
    return employee;
  }

  async deleteForVendor({ vendor_user_id, employee_id }) {
    const employee = await this.getScopedEmployee({
      vendor_user_id,
      employee_id,
      includeArchived: true,
    });
    const employeeQuery = {
      employee_internal_id: employee.employee_internal_id,
      vendor_user_id,
    };

    const completedSalesExist = await OrderModel.exists({
      ...employeeQuery,
      orderStatus: { $in: completedSalesStatuses },
    });

    if (completedSalesExist) {
      throw buildError(
        'Employee cannot be deleted due to prior sales activity. Please Disable Login Access then Archive the Employee.',
        409
      );
    }

    await Model.deleteOne({ _id: employee._id, vendor_user_id });
    return employee;
  }

  async getVendorUser(vendorUserId) {
    const vendor = await UserModel.findOne({
      _id: vendorUserId,
      userType: 'VENDOR',
    }).lean();

    if (!vendor) {
      throw buildError('Vendor not found.', 404);
    }

    return vendor;
  }

  getAssignedLocation(foodTruck, assignedLocationId) {
    return (foodTruck.locations || []).find(
      (location) => location._id?.toString() === assignedLocationId?.toString()
    );
  }

  async validateEmployeeLogin({ vendorAccessCode, employeeLoginId, pin }) {
    const customError = buildError('Invalid employee credentials.', 401);
    const normalizedLoginId = String(employeeLoginId || '').trim().toLowerCase();
    const normalizedAccessCode = String(vendorAccessCode || '')
      .trim()
      .toLowerCase();

    const employees = await Model.find({
      employee_login_id: normalizedLoginId,
      is_active: true,
      is_archived: false,
    }).select('+pin_hash');

    if (!employees.length) {
      throw customError;
    }

    let employee = null;
    let foodTruck = null;

    for (const candidate of employees) {
      const candidateFoodTruck = await FoodTruckService.getByData(
        {
          _id: candidate.food_truck_id,
          userId: candidate.vendor_user_id,
        },
        {
          singleResult: true,
          lean: true,
        }
      );

      const candidateAccessCode = candidateFoodTruck?._id
        ?.toString()
        .slice(-6)
        .toLowerCase();

      if (candidateAccessCode === normalizedAccessCode) {
        employee = candidate;
        foodTruck = candidateFoodTruck;
        break;
      }
    }

    if (!employee || !foodTruck) {
      throw customError;
    }

    const assignedLocation = this.getAssignedLocation(
      foodTruck,
      employee.assigned_location_id
    );
    const assignedTruckUnit = this.getAssignedTruckUnit(
      foodTruck,
      employee.assigned_truck_unit_id
    );

    if (!assignedLocation) {
      throw buildError('Employee assigned location is no longer available.', 403);
    }

    const plan = foodTruck.planId
      ? await PlanService.getById(foodTruck.planId)
      : null;

    assertVendorPlanCapability(
      plan,
      'employeeLogin',
      'Employee login is not available for this vendor plan.'
    );
    const capabilities = getVendorPlanCapabilities(plan);

    const isMatching = await employee.comparePin(pin);
    if (!isMatching) {
      throw customError;
    }

    employee.last_login_at = new Date();
    await employee.save();

    const safeEmployee = employee.toObject();
    delete safeEmployee.pin_hash;
    delete safeEmployee.__v;

    return {
      employee: safeEmployee,
      foodTruck: {
        _id: foodTruck._id,
        name: foodTruck.name,
        logo: foodTruck.logo,
      },
      assignedLocation,
      assignedTruckUnit: {
        _id: assignedTruckUnit._id,
        name: assignedTruckUnit.name,
        phone: assignedTruckUnit.phone || null,
      },
      employeeCapabilities: {
        employeeWalkUpPos: !!capabilities.employeeWalkUpPos,
        walkUpPosPaymentMethods: capabilities.walkUpPosPaymentMethods || [],
        tapToPay: !!capabilities.tapToPay,
      },
    };
  }
}

module.exports = new VendorEmployeeService();
