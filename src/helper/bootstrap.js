const { UserModel, PlanModel, AddOnsModel, categoriesModel, MeatModel, commonDatalistModel, DietModel } = require('../models');

const addAdminIfNotExist = async () => {
  const sudo = await UserModel.findOne({ userType: 'SUPER_ADMIN' });
  if (!sudo) {
    await UserModel.create({
      email: 'superadmin@ft.com',
      username: 'superadmin',
      password: 'superadmin@123',
      firstName: 'super',
      lastName: 'admin',
      userType: 'SUPER_ADMIN',
      verified: true,
    });
    console.log('============super admin created');
  }
};

const categorieotExistfNotExist = async () => {
  try {
    const defaultUsers = [
      { name: 'Combos' },
      { name: 'Sides' },
      { name: 'Desserts' },
      { name: 'Beverages' },
      { name: 'Individual' },
      { name: 'Kids' },
      { name: 'Popular Items' },
      { name: 'Popular Combos' },
    ];

    for (const user of defaultUsers) {
      const exists = await categoriesModel.findOne({ name: user.name });
      if (!exists) {
        await categoriesModel.create(user);
        console.log(`Created: ${user.name}`);
      } else {
        // console.log(`Already exists: ${user.name}`);
      }
    }

    // console.log('============ Default users sync done ============');
  } catch (err) {
    console.error('Error in categorieotExistfNotExist:', err);
  }
};

const meattExistfNotExist = async () => {
  try {
    const defaultUsers = [
      { name: 'Chicken' },
      { name: 'Beef' },
      { name: 'Pork' },
      { name: 'Lam/Goat' },
      { name: 'Fish' },
      { name: 'Vegetarian' },
      { name: 'Vegan' },
      { name: 'Mix(chicken,beef,pork,lamb,fish)' },
      { name: 'Pescatarian' },
      { name: 'NA' },
    ];

    for (const user of defaultUsers) {
      const exists = await MeatModel.findOne({ name: user.name });
      if (!exists) {
        await MeatModel.create(user);
        console.log(`Created: ${user.name}`);
      } else {
        // console.log(`Already exists: ${user.name}`);
      }
    }

    // console.log('============ Default users sync done ============');
  } catch (err) {
    console.error('Error in categorieotExistfNotExist:', err);
  }
};

const seedMeatWellness = async () => {
  try {
    const defaultMeatWellness = [
      {
        name: "Rare",
        key: "meat_wellness",
        value: "rare",
        type: "meat_wellness"
      },
      {
        name: "Medium Rare",
        key: "meat_wellness",
        value: "medium_rare",
        type: "meat_wellness"
      },
      {
        name: "Medium",
        key: "meat_wellness",
        value: "medium",
        type: "meat_wellness"
      },
      {
        name: "Medium Well",
        key: "meat_wellness",
        value: "medium_well",
        type: "meat_wellness"
      },
      {
        name: "Well",
        key: "meat_wellness",
        value: "well",
        type: "meat_wellness"
      },
      {
        name: "Charbroiled",
        key: "meat_wellness",
        value: "charbroiled",
        type: "meat_wellness"
      },
      {
        name: "Customer Choice",
        key: "meat_wellness",
        value: "customer_choice",
        type: "meat_wellness"
      },
      {
        name: "NA",
        key: "meat_wellness",
        value: "NA",
        type: "meat_wellness"
      },
    ];
    const defaultDiscounts = [
      { name: "10% Off", key: "PERCENTAGE", value: "10", type: "discount" },
      { name: "15% Off", key: "PERCENTAGE", value: "15", type: "discount" },
      { name: "20% Off", key: "PERCENTAGE", value: "20", type: "discount" },
      { name: "BOGO", key: "BOGO", value: "bogo", type: "discount" },
      { name: "BOGOHO", key: "BOGOHO", value: "bogoho", type: "discount" }
    ];
    const allData = [...defaultMeatWellness, ...defaultDiscounts];

    for (const item of allData) {
      const exists = await commonDatalistModel.findOne({
        key: item.key,
        value: item.value,
        type: item.type,
        deletedAt: null
      });

      if (!exists) {
        await commonDatalistModel.create(item);
        console.log(`Created: ${item.name}`);
      } else {
        // console.log(`Already exists: ${item.name}`);
      }
    }
    // console.log('✅ Meat wellness sync complete');
  } catch (err) {
    console.error('❌ Error in seedMeatWellness:', err);
  }
};

const dietsExistfNotExist = async () => {
  try {
    const defaultDiet = [
      { name: 'Pescatarian' },
      { name: 'Non-Veg' },
      { name: 'Veg' },
      { name: 'Vegen' },
      { name: 'Eggetarian' },
      { name: 'Keto' }
    ];

    for (const diet of defaultDiet) {
      const exists = await DietModel.findOne({ name: diet.name });
      if (!exists) {
        await DietModel.create(diet);
        console.log(`Created: ${diet.name}`);
      } else {
        // console.log(`Already exists: ${diet.name}`);
      }
    }

    // console.log('============ Default diets sync done ============');
  } catch (err) {
    console.error('Error in dietsExistfNotExist:', err);
  }
};

// const addAddOns = async () => {
//   await AddOnsModel.create({
//     name: 'Social Media Promotion: $125/month',
//   });
//   await AddOnsModel.create({
//     name: 'Order Print Setup: $50 one-time fee',
//   });
//   await AddOnsModel.create({
//     name: 'Accept Event Bookings: $25.00/month',
//   });
// };

// const addPlans = async () => {
//   await PlanModel.create({
//     name: 'Basic',
//     titleColor: '#FC7B03',
//     slug: 'SUB_BASIC',
//     rate: '3.5',
//     rateType: '/per-sale fee',
//     isPopular: true,
//     details: [
//       'Menu and business listing',
//       'Monthly sales report',
//       '1 media link and 1 social/website link',
//       'No dish highlights',
//       'POS services provided (no external POS needed)',
//       'Daily payouts',
//       'Accept cash on pickup only',
//       'Eligible to offer delivery (not to exceed $5.00 fee)',
//     ],
//   });
//
//   await PlanModel.create({
//     name: 'Platinum',
//     titleColor: '#AF52DE',
//     slug: 'SUB_PLATINUM',
//     rate: '4.5',
//     rateType: '/per-sale fee',
//     isPopular: false,
//     details: [
//       'All Basic features',
//       'Advanced reporting (choose 2 reports: Monthly Sales, Sales MoM, Sales by Item)',
//       'Highlight new dishes',
//       '2 media links, 2 social accounts',
//       'POS provided, daily payouts, cash on pickup',
//       'Eligible to offer delivery (not to exceed $5.00 fee)',
//     ],
//   });
//
//   await PlanModel.create({
//     name: 'Elite',
//     titleColor: '#FFCC00',
//     slug: 'SUB_ELITE',
//     rate: '5.5',
//     rateType: '/per-sale fee',
//     isPopular: false,
//     details: [
//       'All Platinum features',
//       'Customizable reporting (3 total)',
//       'Promotion of new dishes',
//       'Up to 4 media/social/website links',
//       'POS provided, daily payouts, cash on pickup',
//       'Eligible to offer delivery (not to exceed $5.00 fee)',
//     ],
//   });
// };

exports.init = () => {
  void addAdminIfNotExist();
  void categorieotExistfNotExist();
  void meattExistfNotExist();
  void seedMeatWellness();
  void dietsExistfNotExist();
  // void addPlans();
  // void addAddOns();
};
