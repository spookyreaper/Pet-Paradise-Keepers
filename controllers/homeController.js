const ensureAuthenticated = require('../middlewares/ensureAuthenticated');

const getHomePage = (req, res, next) => {
  if (!req.session?.userId) return res.render('index', { title: 'Home', user: null });
  return ensureAuthenticated(req, res, error => {
    if (error) return next(error);
    return res.render('index', { title: 'Home', user: req.user });
  });
};

module.exports = {
  getHomePage
};
