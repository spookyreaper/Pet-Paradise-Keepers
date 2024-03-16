const express = require('express');
const router = express.Router();
const homeController = require('../controllers/homeController');
const authController = require('../controllers/authController');
const ownerController = require('../controllers/ownerController');
const sitterController = require('../controllers/sitterController');
const { addPet, viewPets, updatePetInfo, getEditPet } = ownerController;
const ensureAuthenticated = require('../middlewares/ensureAuthenticated');
const Pet = require('../models/Pet');
const User = require('../models/accountSchema');
const fs = require('fs');
const multer = require('multer');
const path = require('path');


// Middleware for checking if the user is authenticated as an owner
function ensureAuthenticatedOwner(req, res, next) {
  if (req.session.userId && req.session.role === 'owner') {
    next();
  } else {
    res.redirect('/login');
  }
}

// Middleware for checking if the user is authenticated as a sitter
function ensureAuthenticatedSitter(req, res, next) {
  if (req.session.userId && req.session.role === 'sitter') {
    next();
  } else {
    res.redirect('/login');
  }
}

// Configuration for file uploads
const storage = multer.diskStorage({
  destination: function(req, file, callback) {
    let dir;
    
    if (req.session.role === 'owner') {
      const ownerId = req.session.userId;
      dir = `public/uploads/owners/${ownerId}/pets`;
    } else if (req.session.role === 'sitter') {
      const sitterId = req.session.userId;
      dir = `public/uploads/sitters/${sitterId}`;
    }

    fs.exists(dir, exist => {
      if (!exist) {
        return fs.mkdir(dir, { recursive: true }, error => callback(error, dir));
      }
      return callback(null, dir);
    });
  },
  filename: function(req, file, callback) {
    const filename = `${Date.now()}${path.extname(file.originalname)}`;
    callback(null, filename);
  }
});

const upload = multer({ storage: storage });


// General routes
router.get('/', homeController.getHomePage);
router.get('/login', authController.getLogin);
router.get('/register', authController.getRegister);
router.post('/login', authController.postLogin);
router.post('/register', authController.postRegister);
router.post('/logout', authController.logout);



// Sitter-specific routes
router.get('/sitter/register', (req, res) => {
  sitterController.getSitterRegister(req, res);
});
router.post('/sitter/register', (req, res) => {
  sitterController.postSitterRegister(req, res);
});
router.get('/sitter/complete-info', ensureAuthenticatedSitter, sitterController.getCompleteSitterInfo);
router.post('/sitter/complete-info', ensureAuthenticatedSitter, upload.single('profilePhoto'), sitterController.postCompleteSitterInfo);

// Owner-specific routes
router.get('/owner/addPet', ensureAuthenticated, ownerController.addPet);
router.post('/owner/addPet', ensureAuthenticated, ownerController.processAddPet);
router.get('/owner/viewPets', ensureAuthenticated, ownerController.viewPets);
router.get('/pets/:petId', ensureAuthenticated, ownerController.showPetDetails);
router.get('/pets/:petId/edit', ensureAuthenticated, ownerController.getEditPet);
router.post('/pets/:petId/edit', ensureAuthenticated, upload.single('photo'), ownerController.updatePetInfo);
router.get('/completeOwnerInfo', ensureAuthenticatedOwner, (req, res) => {
  res.render('completeOwnerInfo', { user: req.user });
});
router.post('/submitOwnerInfo', ensureAuthenticatedOwner, upload.fields([
  { name: 'petPhoto', maxCount: 1 },
  { name: 'ownerPhoto', maxCount: 1 }
]), ownerController.submitOwnerInfo);


module.exports = router;
