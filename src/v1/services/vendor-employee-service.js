const {
  EmployeeRefundCancelRequestModel,
  EmployeeSessionModel,
  OrderModel,
  VendorEmployeeModel: Model,
} = require('../../models');
const { BaseService } = require('../../common-services');
const FoodTruckService = require('./food-truck-service');
const PlanService = require('./plan-service');
const {
  assertVendorPlanCapability,
  getVendorPlanCapabilities,
} = require('../../helper/vendor-plan-helper');

const buildError = (message, code = 409) => {
  const error = new Error(message);
  error.code = code;
  return error;
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
    first_name,
    last_name,
    zip_code,
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

    if (!pin) {
      throw buildError('Employee PIN is required.');
    }

    const employee_login_id = await this.generateUniqueEmployeeLoginId({
      food_truck_id,
      first_name,
      last_name,
      zip_code,
    });

    return this.create({
      ...rest,
      vendor_user_id,
      food_truck_id,
      assigned_location_id,
      first_name,
      last_name,
      zip_code,
      employee_login_id,
      pin_hash: pin,
    });
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

  async getScopedEmployee({ vendor_user_id, employee_id }) {
    const employee = await this.getByData(
      {
        _id: employee_id,
        vendor_user_id,
        is_archived: false,
      },
      { singleResult: true }
    );

    if (!employee) {
      throw buildError('Employee not found.', 404);
    }

    return employee;
  }

  async updateForVendor({ vendor_user_id, employee_id, update }) {
    const employee = await this.getScopedEmployee({ vendor_user_id, employee_id });
    let assignedLocationChanged = false;

    if (update.assigned_location_id) {
      const foodTruck = await this.getVendorFoodTruck(
        vendor_user_id,
        employee.food_truck_id
      );
      this.assertExistingLocation(foodTruck, update.assigned_location_id);
      assignedLocationChanged =
        employee.assigned_location_id?.toString() !==
        update.assigned_location_id?.toString();
      employee.assigned_location_id = update.assigned_location_id;
    }

    ['first_name', 'last_name', 'zip_code'].forEach((field) => {
      if (update[field] !== undefined) {
        employee[field] = update[field];
      }
    });

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

  async resetPinForVendor({ vendor_user_id, employee_id, pin }) {
    if (!pin) {
      throw buildError('Employee PIN is required.');
    }

    const employee = await this.getScopedEmployee({ vendor_user_id, employee_id });
    employee.pin_hash = pin;
    await employee.save();
    return employee;
  }

  async archiveForVendor({ vendor_user_id, employee_id }) {
    const employee = await this.getScopedEmployee({ vendor_user_id, employee_id });
    employee.is_active = false;
    employee.is_working = false;
    employee.is_archived = true;
    await employee.save();
    return employee;
  }

  async deleteForVendor({ vendor_user_id, employee_id }) {
    const employee = await this.getScopedEmployee({ vendor_user_id, employee_id });
    const employeeQuery = {
      employee_internal_id: employee.employee_internal_id,
      vendor_user_id,
    };

    const [sessionExists, orderExists, requestExists] = await Promise.all([
      EmployeeSessionModel.exists(employeeQuery),
      OrderModel.exists(employeeQuery),
      EmployeeRefundCancelRequestModel.exists(employeeQuery),
    ]);

    if (sessionExists || orderExists || requestExists) {
      throw buildError(
        'This employee has activity history and cannot be deleted. Archive the employee instead.',
        409
      );
    }

    await Model.deleteOne({ _id: employee._id, vendor_user_id });
    return employee;
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
      employeeCapabilities: {
        employeeWalkUpPos: !!capabilities.employeeWalkUpPos,
        walkUpPosPaymentMethods: capabilities.walkUpPosPaymentMethods || [],
        tapToPay: !!capabilities.tapToPay,
      },
    };
  }
}

module.exports = new VendorEmployeeService();
