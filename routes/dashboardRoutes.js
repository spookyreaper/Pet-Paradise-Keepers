const express = require('express');
const router = express.Router();
const ensureAuthenticated = require('../middlewares/ensureAuthenticated');
const dashboardController = require('../controllers/dashboardController');
const authController = require('../controllers/authController');

router.get('/', ensureAuthenticated, dashboardController.getDashboard);

// Preserve older dashboard profile URLs while keeping one profile handler per role.
router.get('/profile', ensureAuthenticated, (req, res) => {
  res.redirect(`/${req.user.role}/profile`);
});

router.post('/profile', ensureAuthenticated, (req, res) => {
  res.redirect(307, `/${req.user.role}/profile`);
});

router.post('/logout', authController.logout);

module.exports = router;
