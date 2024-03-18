const express = require('express');
const router = express.Router();
const ensureAuthenticated = require('../middlewares/ensureAuthenticated');
const dashboardController = require('../controllers/dashboardController');
const User = require('../models/accountSchema'); 

// Home route
router.get('/', ensureAuthenticated, (req, res) => {
  User.findById(req.session.userId)
    .populate('pets')
    .exec()
    .then(user => {
      if (!user) {
        return res.redirect('/login');
      }
      
      if (user.role === 'owner') {
        res.render('owner/dashboard', { user: user, dashboardType: 'owner' });
      } else if (user.role === 'sitter') {
        res.render('sitter/dashboard', { user: user, dashboardType: 'sitter' });
      }
    })
    .catch(err => {
      console.error('Error fetching user from database:', err);
      return res.status(500).render('error', { error: err });
    });
});

// Display the profile page based on user role
router.get('/profile', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.redirect('/login');
    }
    const profileTemplate = user.role === 'owner' ? 'owner/profile' : 'sitter/profile';
    res.render(profileTemplate, { user: user });
  } catch (error) {
    console.error('Error fetching user from database:', error);
    res.status(500).render('error', { error: error });
  }
});


router.post('/profile', ensureAuthenticated, async (req, res) => {
  
});


router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Could not log out, please try again.' });
    }
    res.json({ redirect: '/login' });
  });
});

module.exports = router;
