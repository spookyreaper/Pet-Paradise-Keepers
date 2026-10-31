const express = require('express');
const router = express.Router();
const homeController = require('../controllers/homeController');
const authController = require('../controllers/authController');
const ownerController = require('../controllers/ownerController');
const sitterController = require('../controllers/sitterController');
const petController = require('../controllers/petController');
const ensureAuthenticatedOwner = require('../middlewares/ensureAuthenticatedOwner'); 
const ensureAuthenticatedSitter = require('../middlewares/ensureAuthenticatedSitter'); 
const upload = require('../middlewares/uploadConfig');

// General routes
router.get('/', homeController.getHomePage);
router.get('/login', authController.getLogin);
router.get('/register', authController.getRegister);
router.post('/login', authController.postLogin);
router.post('/register', authController.postRegister);
router.post('/logout', authController.logout);

// Sitter-specific routes
router.get('/sitter/register', sitterController.getSitterRegister);
router.post('/sitter/register', sitterController.postSitterRegister);
router.get('/sitter/profile', ensureAuthenticatedSitter, sitterController.getSitterProfile);
router.post('/sitter/profile', ensureAuthenticatedSitter, upload.single('profilePhoto'), sitterController.updateSitterProfile);
router.delete('/sitter/profile/delete', ensureAuthenticatedSitter, sitterController.deleteAccount);
router.get('/sitter/complete-info', ensureAuthenticatedSitter, sitterController.getCompleteSitterInfo);
router.post('/sitter/complete-info', ensureAuthenticatedSitter, upload.single('profilePhoto'), sitterController.postCompleteSitterInfo);

// Owner-specific routes
router.get('/owner/profile', ensureAuthenticatedOwner, ownerController.getOwnerProfile);
router.get('/owner/profile/edit', ensureAuthenticatedOwner, ownerController.getEditProfile);
router.post('/owner/profile', ensureAuthenticatedOwner, upload.single('ownerPhoto'), ownerController.updateProfile);
router.delete('/owner/profile/delete', ensureAuthenticatedOwner, ownerController.deleteAccount);
router.get('/completeOwnerInfo', ensureAuthenticatedOwner, ownerController.completeOwnerInfo);
router.post('/submitOwnerInfo', ensureAuthenticatedOwner, upload.fields([
  { name: 'petPhoto', maxCount: 1 },
  { name: 'ownerPhoto', maxCount: 1 }
]), ownerController.submitOwnerInfo);

// Pet routes
router.get('/pets/add', ensureAuthenticatedOwner, petController.addPet);
router.post('/pets/add', ensureAuthenticatedOwner, upload.single('petPhoto'), petController.processAddPet);
router.get('/pets', ensureAuthenticatedOwner, petController.viewPets);
router.get('/pets/:petId', ensureAuthenticatedOwner, petController.showPetDetails);
router.get('/pets/:petId/edit', ensureAuthenticatedOwner, petController.getEditPet);
router.post('/pets/:petId/edit', ensureAuthenticatedOwner, upload.single('photo'), petController.updatePetInfo);
router.delete('/pets/:petId', ensureAuthenticatedOwner, petController.deletePet);
router.delete('/pets/:petId/delete', ensureAuthenticatedOwner, petController.deletePet);

// Keep existing owner pet links working while pet management lives in its own controller.
router.get('/owner/addPet', ensureAuthenticatedOwner, (req, res) => res.redirect('/pets/add'));
router.post('/owner/addPet', ensureAuthenticatedOwner, upload.single('petPhoto'), petController.processAddPet);
router.get('/owner/viewPets', ensureAuthenticatedOwner, (req, res) => res.redirect('/pets'));

module.exports = router;
