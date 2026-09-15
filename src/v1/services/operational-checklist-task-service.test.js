const assert = require('assert');
const service = require('./operational-compliance-form-service');
const { FoodTruckModel } = require('../../models');

const originalGetScope = service.getScope;
const originalFindById = FoodTruckModel.findById;

const tasks = [
  {
    _id: 'task-1',
    form_type: 'OPENING_CHECKLIST',
    title: 'Safety',
    details: 'Check the fire extinguisher.',
    is_active: true,
  },
  {
    _id: 'task-2',
    form_type: 'OPENING_CHECKLIST',
    title: 'Old task',
    details: 'No longer needed.',
    is_active: false,
  },
];
const nativePush = tasks.push.bind(tasks);
tasks.push = (value) => nativePush({ _id: `task-${tasks.length + 1}`, ...value });
tasks.id = (id) => tasks.find((item) => String(item._id) === String(id));

const foodTruck = {
  operational_checklist_tasks: tasks,
  async save() { this.saved = true; },
};
const vendor = { _id: '507f1f77bcf86cd799439011', userType: 'VENDOR' };

(async () => {
  try {
    service.getScope = async () => ({
      vendor_user_id: vendor._id,
      food_truck_id: 'food-truck-1',
    });
    FoodTruckModel.findById = () => ({ select: async () => foodTruck });

    const listed = await service.listChecklistTasks({ user: vendor, type: 'OPENING_CHECKLIST' });
    assert.deepEqual(listed.map((item) => String(item._id)), ['task-1']);

    const created = await service.createChecklistTask({
      user: vendor,
      payload: {
        form_type: 'OPENING_CHECKLIST',
        title: '  Windows  ',
        details: '  Open and secure the service windows.  ',
      },
    });
    assert.equal(created.title, 'Windows');
    assert.equal(created.details, 'Open and secure the service windows.');

    const seed = await service.getEmployeeChecklistSeed({}, 'OPENING_CHECKLIST');
    assert.deepEqual(seed.map((item) => item.area), ['Safety', 'Windows']);
    assert.ok(seed.every((item) => item.completed === false && item.notes === ''));

    await service.archiveChecklistTask({ user: vendor, taskId: created._id });
    assert.equal(tasks.id(created._id).is_active, false);
    assert.ok(tasks.id(created._id).archived_at);

    await assert.rejects(
      service.createChecklistTask({
        user: { userType: 'EMPLOYEE' },
        payload: { form_type: 'OPENING_CHECKLIST', title: 'Forged', details: 'Not allowed' },
      }),
      /Only the vendor can manage checklist tasks/
    );
    console.log('operational checklist task tests passed');
  } finally {
    service.getScope = originalGetScope;
    FoodTruckModel.findById = originalFindById;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
