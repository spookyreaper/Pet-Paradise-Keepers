const Account = require('../models/accountSchema');
const Pet = require('../models/Pet');
const { removeAccountMarketplaceData } = require('../utils/marketplaceCleanup');
const authController = require('./authController');
const { destroySession } = require('../utils/session');
const { uploadedPhoto, discardUploads, removeStoredPhoto, removeAccountUploads } = require('../utils/upload');
const { inputError, sitterInfo, assertProfileEmailAvailable, profileUpdates, formError } = require('../utils/profile');

function getSitterRegister(req, res) {
  return res.redirect('/register?role=sitter');
}

function postSitterRegister(req, res, next) {
  req.body = { ...req.body, role: 'sitter' };
  return authController.postRegister(req, res, next);
}

async function sitterAccount(req, res) {
  if (!req.session || !req.session.userId) {
    res.redirect('/login');
    return null;
  }
  const user = req.user || await Account.findById(req.session.userId);
  if (!user) {
    await destroySession(req, res);
    res.redirect('/login');
    return null;
  }
  if (user.role !== 'sitter') throw inputError('Access denied.', 403);
  return user;
}

async function getSitterProfile(req, res, next) {
  try {
    const user = await sitterAccount(req, res);
    if (user) return res.render('sitter/profile', { user, errorMessage: null });
  } catch (error) {
    return next(error);
  }
}

async function updateSitterProfile(req, res, next) {
  let user;
  let originalPhoto;
  try {
    user = await sitterAccount(req, res);
    if (!user) {
      await discardUploads(req);
      return;
    }
    const updates = await profileUpdates(user, req.body, true);
    await assertProfileEmailAvailable(user, updates.email);
    originalPhoto = user.profilePhoto;
    if (req.file) updates.profilePhoto = uploadedPhoto(req.file);
    Object.assign(user, updates);
    await user.save();
    if (req.file && user.profilePhoto !== originalPhoto) await removeStoredPhoto(originalPhoto);
    return res.redirect('/dashboard');
  } catch (error) {
    if (user && originalPhoto !== undefined) user.profilePhoto = originalPhoto;
    return formError(req, res, next, error, 'sitter/profile', user);
  }
}

async function getCompleteSitterInfo(req, res, next) {
  try {
    const user = await sitterAccount(req, res);
    if (user) return res.render('completeSitterInfo', { user, errorMessage: null });
  } catch (error) {
    return next(error);
  }
}

async function postCompleteSitterInfo(req, res, next) {
  let user;
  let originalPhoto;
  try {
    user = await sitterAccount(req, res);
    if (!user) {
      await discardUploads(req);
      return;
    }
    const updates = sitterInfo(req.body, true);
    originalPhoto = user.profilePhoto;
    if (req.file) updates.profilePhoto = uploadedPhoto(req.file);
    Object.assign(user, updates);
    await user.save();
    if (req.file && user.profilePhoto !== originalPhoto) await removeStoredPhoto(originalPhoto);
    return res.redirect('/dashboard');
  } catch (error) {
    if (user && originalPhoto !== undefined) user.profilePhoto = originalPhoto;
    return formError(req, res, next, error, 'completeSitterInfo', user);
  }
}

async function deleteAccount(req, res, next) {
  try {
    const user = await sitterAccount(req, res);
    if (!user) return;
    const deleted = await Account.findByIdAndDelete(user._id);
    let cleanupError;
    try {
      if (deleted) {
        await Pet.deleteMany({ owner: user._id });
        await removeAccountMarketplaceData(user._id);
      }
    } catch (error) {
      cleanupError = error;
    }
    if (deleted && !cleanupError) await removeAccountUploads(user);
    await destroySession(req, res);
    if (cleanupError) return next(cleanupError);
    return res.redirect('/login');
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getSitterRegister,
  postSitterRegister,
  getCompleteSitterInfo,
  postCompleteSitterInfo,
  getSitterProfile,
  updateSitterProfile,
  deleteAccount,
};
