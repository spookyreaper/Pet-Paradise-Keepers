const mongoose = require('mongoose');
const User = require('../models/accountSchema');
const { destroySession } = require('../utils/session');

async function ensureAuthenticated(req, res, next) {
  try {
    if (!req.session || !req.session.userId) return res.redirect('/login');
    const user = mongoose.isObjectIdOrHexString(req.session.userId)
      ? await User.findById(req.session.userId)
      : null;

    if (!user || !['owner', 'sitter'].includes(user.role)) {
      await destroySession(req, res);
      return res.redirect('/login');
    }

    req.user = user;
    res.locals.user = user;
    req.session.role = user.role;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = ensureAuthenticated;
