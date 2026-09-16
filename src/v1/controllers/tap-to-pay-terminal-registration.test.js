const assert = require('assert');
const services = require('../services');

const originalFoodTruckGetByData = services.FoodTruckService.getByData;
const originalEmployeeGetByData = services.VendorEmployeeService.getByData;
const originalPlanGetById = services.PlanService.getById;
const originalTerminalRegister = services.TapToPayTerminalService.register;
const VendorComplianceService = require('../services/vendor-compliance-service');
const originalCalculateComplianceSummary = VendorComplianceService.calculateComplianceSummary;
const ActivationCodeHelper = require('../../helper/cybersource-activation-code-helper');
const originalCreateActivationCode = ActivationCodeHelper.createActivationCode;
const Controller = require('./food-truck-controller');

const run = async () => {
  const terminalId = 'acceptance-device-serial-123456789';

  try {
    services.TapToPayTerminalService.register = async ({ body }) => ({
      _id: 'terminal-record-1',
      reactivation_required: false,
      device_id: body.device_id,
    });
    const vendorTruck = {
      _id: 'truck-1',
      userId: 'vendor-1',
      tap_to_pay_serial_number: null,
      async save() {
        this.saved = true;
      },
    };
    services.FoodTruckService.getByData = async (query) => {
      if (query._id) return vendorTruck;
      assert.strictEqual(String(query.userId), 'vendor-1');
      return vendorTruck;
    };

    let responsePayload;
    await Controller.registerTapToPayTerminal(
      {
        body: { device_id: terminalId },
        user: { _id: 'vendor-1', userType: 'VENDOR' },
      },
      {
        data(payload) {
          responsePayload = payload;
          return payload;
        },
        error(error) {
          throw error;
        },
      },
      (error) => {
        throw error;
      }
    );

    assert.strictEqual(vendorTruck.tap_to_pay_serial_number, terminalId);
    assert.strictEqual(vendorTruck.saved, true);
    assert.deepStrictEqual(responsePayload, {
      registered: true,
      terminal_id: 'terminal-record-1',
      terminal_serial_suffix: '6789',
      reactivation_required: false,
    });
    assert.strictEqual(JSON.stringify(responsePayload).includes(terminalId), false);

    const employee = {
      _id: 'employee-1',
      food_truck_id: 'truck-1',
      employee_internal_id: 'EMP-1',
      tap_to_pay_serial_number: null,
      async save() {
        this.saved = true;
      },
    };
    services.VendorEmployeeService.getByData = async (query) => {
      assert.strictEqual(String(query._id), 'employee-1');
      assert.strictEqual(query.employee_internal_id, 'EMP-1');
      assert.strictEqual(String(query.food_truck_id), 'truck-1');
      return employee;
    };

    await Controller.registerTapToPayTerminal(
      {
        body: { device_id: terminalId },
        user: {
          _id: 'employee-1',
          userType: 'EMPLOYEE',
          employee_internal_id: 'EMP-1',
          food_truck_id: 'truck-1',
        },
      },
      {
        data(payload) {
          responsePayload = payload;
          return payload;
        },
        error(error) {
          throw error;
        },
      },
      (error) => {
        throw error;
      }
    );

    assert.strictEqual(employee.tap_to_pay_serial_number, terminalId);
    assert.strictEqual(employee.saved, true);
    assert.strictEqual(responsePayload.terminal_serial_suffix, '6789');

    const eligibleTruck = {
      _id: 'truck-eligible',
      planId: 'elite-plan',
    };
    services.FoodTruckService.getByData = async (query) => {
      assert.strictEqual(String(query.userId), 'vendor-eligible');
      return eligibleTruck;
    };
    services.PlanService.getById = async (planId) => {
      assert.strictEqual(String(planId), 'elite-plan');
      return { name: 'Elite', capabilities: { tapToPay: true } };
    };
    VendorComplianceService.calculateComplianceSummary = async (foodTruck) => {
      assert.strictEqual(foodTruck, eligibleTruck);
      return { eligible: true, score: 100 };
    };
    ActivationCodeHelper.createActivationCode = async () => ({
      token: 'one-time-code',
      ttl: 86399805,
    });

    const responseHeaders = {};
    await Controller.createTapToPayActivationCode(
      {
        user: { _id: 'vendor-eligible', userType: 'VENDOR' },
      },
      {
        set(name, value) {
          responseHeaders[name] = value;
        },
        data(payload) {
          responsePayload = payload;
          return payload;
        },
        error(error) {
          throw error;
        },
      },
      (error) => {
        throw error;
      }
    );

    assert.deepStrictEqual(responsePayload, {
      activation_code: 'one-time-code',
      expires_in_ms: 86399805,
    });
    assert.strictEqual(responseHeaders['Cache-Control'], 'no-store');
    assert.strictEqual(responseHeaders.Pragma, 'no-cache');
    console.log('Tap to Pay terminal registration tests passed.');
  } finally {
    services.FoodTruckService.getByData = originalFoodTruckGetByData;
    services.VendorEmployeeService.getByData = originalEmployeeGetByData;
    services.PlanService.getById = originalPlanGetById;
    services.TapToPayTerminalService.register = originalTerminalRegister;
    VendorComplianceService.calculateComplianceSummary = originalCalculateComplianceSummary;
    ActivationCodeHelper.createActivationCode = originalCreateActivationCode;
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
