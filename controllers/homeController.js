const User = require('../models/accountSchema'); 


const getHomePage = (req, res) => {
  if (req.session.userId) {
    User.findById(req.session.userId)
      .exec()
      .then(user => {
        res.render('index', {
          title: 'Home',
          user: user 
        });
      })
      .catch(err => {
        console.error('Error fetching user from database:', err);
        res.status(500).render('error', { error: err });
      });
  } else {
    res.render('index', {
      title: 'Home',
      user: null 
    });
  }
};

module.exports = {
  getHomePage
};