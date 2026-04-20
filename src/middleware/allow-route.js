exports.allowedTo = (userType) => (req, res, next) => {
  try {
    if (!userType?.length) {
      throw new Error(`'userType' is required`);
    }

    if (!userType.includes(req.user.userType)) {
      throw new Error(`You doesn't have access to this route`);
    }

    next();
  } catch (e) {
    return res.error(e, 403);
  }
};
