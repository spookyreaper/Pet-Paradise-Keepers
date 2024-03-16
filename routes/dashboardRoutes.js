const express = require('express');
const router = express.Router();
const ensureAuthenticated = require('../middlewares/ensureAuthenticated');
const dashboardController = require('../controllers/dashboardController');
const Account = require('../models/accountSchema');


router.get('/', ensureAuthenticated, (req, res) => {
  Account.findById(req.session.userId)
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
