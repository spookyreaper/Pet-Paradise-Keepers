const Pet = require('../models/Pet');
const User = require('../models/accountSchema');
const { removePetMarketplaceData } = require('../utils/marketplaceCleanup');
const { uploadedPhoto, discardUploads, removeStoredPhoto } = require('../utils/upload');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function currentOwner(req) {
  if (!req.session || !req.session.userId) return null;
  const user = req.user || await User.findById(req.session.userId);
  if (user && user.role !== 'owner') throw httpError(403, 'Only pet owners can manage pets.');
  return user;
}

function petFilter(req, user) {
  const petId = req.params.petId;
  if (typeof petId !== 'string' || !/^[a-f\d]{24}$/i.test(petId)) {
    throw httpError(400, 'Invalid pet ID.');
  }
  return { _id: petId, owner: user._id };
}

function petInput(body = {}) {
  // Accept the older form field names while storing the existing schema key.
  const rawName = body.name ?? body.petName;
  const rawType = body.type ?? body.petType;
  const rawHistory = body.medicationHistory ?? body.medicalHistory ?? body.petMedicalHistory ?? '';
  const values = {
    name: typeof rawName === 'string' ? rawName.trim() : '',
    type: typeof rawType === 'string' ? rawType.trim() : '',
    medicationHistory: typeof rawHistory === 'string' ? rawHistory.trim() : '',
  };

  let errorMessage = '';
  if (!values.name || !values.type) errorMessage = 'Please provide your pet’s name and type.';
  else if (values.name.length > 100 || values.type.length > 100) {
    errorMessage = 'Pet names and types must be 100 characters or fewer.';
  } else if (typeof rawHistory !== 'string' || values.medicationHistory.length > 5000) {
    errorMessage = 'Medical history must be text of 5,000 characters or fewer.';
  }

  return { values, errorMessage };
}

async function addPet(req, res, next) {
  try {
    const user = await currentOwner(req);
    if (!user) return res.redirect('/login');
    return res.render('addPet', { user, pet: {}, errorMessage: '' });
  } catch (error) {
    return next(error);
  }
}

async function processAddPet(req, res, next) {
  let newPet;
  try {
    const user = await currentOwner(req);
    if (!user) {
      await discardUploads(req);
      return res.redirect('/login');
    }
    const { values, errorMessage } = petInput(req.body);
    if (errorMessage) {
      await discardUploads(req);
      return res.status(400).render('addPet', { user, pet: values, errorMessage });
    }

    newPet = await Pet.create({ ...values, photoUrl: uploadedPhoto(req.file), owner: user._id });
    const updatedUser = await User.findByIdAndUpdate(user._id, { $addToSet: { pets: newPet._id } });
    if (!updatedUser) throw httpError(404, 'Your account could not be found.');
    return res.redirect('/dashboard');
  } catch (error) {
    // Do not leave a pet or uploaded photo behind if linking the account fails.
    let removeUploads = true;
    if (newPet) {
      try {
        await Pet.deleteOne({ _id: newPet._id, owner: newPet.owner });
      } catch (cleanupError) {
        // The surviving pet still references this photo; keep the file intact.
        removeUploads = false;
        delete req.file;
        delete req.files;
        console.error('Unable to remove an unlinked pet:', cleanupError);
      }
    }
    if (removeUploads) await discardUploads(req);
    return next(error);
  }
}

async function getEditPet(req, res, next) {
  try {
    const user = await currentOwner(req);
    if (!user) return res.redirect('/login');
    const pet = await Pet.findOne(petFilter(req, user));
    if (!pet) throw httpError(404, 'Pet not found.');
    return res.render('editPet', { pet, user, errorMessage: '' });
  } catch (error) {
    return next(error);
  }
}

async function updatePetInfo(req, res, next) {
  try {
    const user = await currentOwner(req);
    if (!user) {
      await discardUploads(req);
      return res.redirect('/login');
    }
    const filter = petFilter(req, user);
    const existingPet = await Pet.findOne(filter);
    if (!existingPet) throw httpError(404, 'Pet not found.');

    const { values, errorMessage } = petInput(req.body);
    if (errorMessage) {
      await discardUploads(req);
      return res.status(400).render('editPet', {
        user,
        pet: { _id: existingPet._id, photoUrl: existingPet.photoUrl, ...values },
        errorMessage,
      });
    }
    if (req.file) values.photoUrl = uploadedPhoto(req.file);
    const pet = await Pet.findOneAndUpdate(filter, { $set: values }, { new: true, runValidators: true });
    if (!pet) throw httpError(404, 'Pet not found.');
    if (req.file && values.photoUrl !== existingPet.photoUrl) {
      await removeStoredPhoto(existingPet.photoUrl);
    }
    return res.redirect('/dashboard');
  } catch (error) {
    await discardUploads(req);
    return next(error);
  }
}

async function viewPets(req, res, next) {
  try {
    const user = await currentOwner(req);
    if (!user) return res.redirect('/login');
    const pets = await Pet.find({ owner: user._id });
    return res.render('viewPets', { user, pets });
  } catch (error) {
    return next(error);
  }
}

async function showPetDetails(req, res, next) {
  try {
    const user = await currentOwner(req);
    if (!user) return res.redirect('/login');
    const pet = await Pet.findOne(petFilter(req, user));
    if (!pet) throw httpError(404, 'Pet not found.');
    return res.render('petDetails', { user, pet });
  } catch (error) {
    return next(error);
  }
}

async function deletePet(req, res, next) {
  try {
    const user = await currentOwner(req);
    if (!user) return res.redirect('/login');
    const pet = await Pet.findOneAndDelete(petFilter(req, user));
    if (!pet) throw httpError(404, 'Pet not found.');
    await removeStoredPhoto(pet.photoUrl);
    let cleanupError;
    try { await removePetMarketplaceData(pet._id); } catch (error) { cleanupError = error; }
    await User.findByIdAndUpdate(user._id, { $pull: { pets: pet._id } });
    if (cleanupError) return next(cleanupError);
    return res.redirect('/dashboard');
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  addPet,
  deletePet,
  processAddPet,
  getEditPet,
  updatePetInfo,
  viewPets,
  showPetDetails,
};
