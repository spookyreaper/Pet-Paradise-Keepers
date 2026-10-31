const User = require('../models/accountSchema');
const Pet = require('../models/Pet');
const { removeAccountMarketplaceData } = require('../utils/marketplaceCleanup');
const { destroySession } = require('../utils/session');
const { uploadedPhoto, discardUploads, removeStoredPhoto, removeAccountUploads } = require('../utils/upload');
const { inputError, textField, assertProfileEmailAvailable, profileUpdates, formError } = require('../utils/profile');

async function ownerAccount(req, res) {
  if (!req.session || !req.session.userId) {
    res.redirect('/login');
    return null;
  }
  const user = req.user || await User.findById(req.session.userId);
  if (!user) {
    await destroySession(req, res);
    res.redirect('/login');
    return null;
  }
  if (user.role !== 'owner') throw inputError('Access denied.', 403);
  return user;
}

async function submitOwnerInfo(req, res, next) {
  let user;
  let pet;
  let originalPhoto;
  try {
    user = await ownerAccount(req, res);
    if (!user) {
      await discardUploads(req);
      return;
    }
    const petName = textField(req.body, 'petName', "Pet's name");
    const petType = textField(req.body, 'petType', "Pet's type");
    const medicationHistory = textField(req.body, 'petMedicalHistory', "Pet's medical history");
    if (Boolean(petName) !== Boolean(petType)) {
      throw inputError('Enter both a name and type to add your first pet.');
    }
    if (petName.length > 100 || petType.length > 100 || medicationHistory.length > 5000) {
      throw inputError('Keep pet names and types under 100 characters and medical history under 5,000 characters.');
    }
    const petPhoto = req.files?.petPhoto?.[0];
    const ownerPhoto = req.files?.ownerPhoto?.[0];
    if (petPhoto && !petName) throw inputError('Enter a pet name and type before uploading a pet photo.');

    originalPhoto = user.profilePhoto;
    if (ownerPhoto) user.profilePhoto = uploadedPhoto(ownerPhoto);
    // Validate the account before creating a pet so invalid profile data cannot leave an orphan.
    await user.validate();
    if (petName) {
      pet = await Pet.create({
        name: petName,
        type: petType,
        medicationHistory,
        photoUrl: petPhoto ? uploadedPhoto(petPhoto) : '',
        owner: user._id,
      });
      if (!Array.isArray(user.pets)) user.pets = [];
      user.pets.push(pet._id);
    }
    await user.save();
    if (ownerPhoto && user.profilePhoto !== originalPhoto) await removeStoredPhoto(originalPhoto);
    return res.redirect('/dashboard');
  } catch (error) {
    if (user && originalPhoto !== undefined) user.profilePhoto = originalPhoto;
    if (pet) {
      try {
        await Pet.deleteOne({ _id: pet._id, owner: user._id });
      } catch (cleanupError) {
        // The pet can still reference its photo when rollback fails.
        delete req.file;
        delete req.files;
        return next(cleanupError);
      }
    }
    return formError(req, res, next, error, 'completeOwnerInfo', user);
  }
}

async function completeOwnerInfo(req, res, next) {
  try {
    const user = await ownerAccount(req, res);
    if (user) return res.render('completeOwnerInfo', { user, errorMessage: null });
  } catch (error) {
    return next(error);
  }
}

async function getOwnerProfile(req, res, next) {
  try {
    const user = await ownerAccount(req, res);
    if (user) return res.render('owner/profile', { user, errorMessage: null });
  } catch (error) {
    return next(error);
  }
}

async function updateProfile(req, res, next) {
  let user;
  let originalPhoto;
  try {
    user = await ownerAccount(req, res);
    if (!user) {
      await discardUploads(req);
      return;
    }
    const updates = await profileUpdates(user, req.body);
    await assertProfileEmailAvailable(user, updates.email);
    originalPhoto = user.profilePhoto;
    if (req.file) updates.profilePhoto = uploadedPhoto(req.file);
    Object.assign(user, updates);
    await user.save();
    if (req.file && user.profilePhoto !== originalPhoto) await removeStoredPhoto(originalPhoto);
    return res.redirect('/dashboard');
  } catch (error) {
    if (user && originalPhoto !== undefined) user.profilePhoto = originalPhoto;
    return formError(req, res, next, error, 'owner/profile', user);
  }
}

async function deleteAccount(req, res, next) {
  try {
    const user = await ownerAccount(req, res);
    if (!user) return;
    const deleted = await User.findByIdAndDelete(user._id);
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
  submitOwnerInfo,
  completeOwnerInfo,
  getOwnerProfile,
  getEditProfile: getOwnerProfile,
  updateProfile,
  deleteAccount,
};
