const User = require('../models/accountSchema');
const { destroySession } = require('../utils/session');
const { inputError } = require('../utils/profile');

async function getDashboard(req, res, next) {
  try {
    if (!req.session || !req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId).populate('pets');
    if (!user) {
      await destroySession(req, res);
      return res.redirect('/login');
    }
    if (user.role !== 'owner' && user.role !== 'sitter') {
      throw inputError('Access denied.', 403);
    }
    return res.render(`${user.role}/dashboard`, { user, dashboardType: user.role });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getDashboard };
