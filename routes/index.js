const express = require('express');
const router = express.Router();
const homeController = require('../controllers/homeController');
const authController = require('../controllers/authController');
const ownerController = require('../controllers/ownerController');
const sitterController = require('../controllers/sitterController');
const ensureAuthenticated = require('../middlewares/ensureAuthenticated');
const ensureAuthenticatedOwner = require('../middlewares/ensureAuthenticatedOwner'); // Import the owner middleware
const ensureAuthenticatedSitter = require('../middlewares/ensureAuthenticatedSitter'); // Import the sitter middleware
const upload = require('../middlewares/uploadConfig'); // Ensure this file exists and is configured correctly

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
router.get('/sitter/profile', ensureAuthenticated, sitterController.getSitterProfile);
router.post('/sitter/profile', ensureAuthenticated, upload.single('profilePhoto'), sitterController.updateSitterProfile);
router.delete('/sitter/profile/delete', ensureAuthenticated, sitterController.deleteAccount);
router.get('/sitter/complete-info', ensureAuthenticatedSitter, sitterController.getCompleteSitterInfo);
router.post('/sitter/complete-info', ensureAuthenticatedSitter, upload.single('profilePhoto'), sitterController.postCompleteSitterInfo);

// Owner-specific routes
router.get('/owner/addPet', ensureAuthenticatedOwner, ownerController.addPet);
router.post('/owner/addPet', ensureAuthenticatedOwner, upload.single('petPhoto'), ownerController.processAddPet);
router.get('/owner/viewPets', ensureAuthenticatedOwner, ownerController.viewPets);
router.get('/owner/profile', ensureAuthenticated, ownerController.getOwnerProfile);
router.get('/owner/profile', ensureAuthenticated, ensureAuthenticatedOwner, ownerController.getEditProfile);
router.post('/owner/profile', ensureAuthenticated, ensureAuthenticatedOwner, ownerController.updateProfile);
router.delete('/profile/delete', ensureAuthenticated, ownerController.deleteAccount);
router.get('/completeOwnerInfo', ensureAuthenticatedOwner, ownerController.completeOwnerInfo);
router.post('/submitOwnerInfo', ensureAuthenticatedOwner, upload.fields([
  { name: 'petPhoto', maxCount: 1 },
  { name: 'ownerPhoto', maxCount: 1 }
]), ownerController.submitOwnerInfo);


// Pet routes
router.get('/pets/:petId', ensureAuthenticatedOwner, ownerController.showPetDetails);
router.get('/pets/:petId/edit', ensureAuthenticatedOwner, ownerController.getEditPet);
router.post('/pets/:petId/edit', ensureAuthenticatedOwner, upload.single('photo'), ownerController.updatePetInfo);
router.delete('/pets/:petId', ensureAuthenticatedOwner, ownerController.deletePet);

module.exports = router;
