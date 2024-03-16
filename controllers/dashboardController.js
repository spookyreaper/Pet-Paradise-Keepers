const User = require('../models/accountSchema');

async function getDashboard(req, res) {
  try {
    const userId = req.session.userId;
    if (!userId) {
      return res.redirect('/login');
    }

    const user = await User.findById(userId);
    if (!user) {
      console.error('User not found');
      return res.status(404).render('error', { error: 'User not found' });
    }

    res.render('dashboard', { user: user });
  } catch (err) {
    console.error('Error fetching user from database:', err);
    res.status(500).render('error', { error: 'Internal server error' });
  }
}

module.exports = {
  getDashboard,
};
