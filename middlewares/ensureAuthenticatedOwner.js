function ensureAuthenticatedOwner(req, res, next) {
    if (req.session.userId && req.session.role === 'owner') {
      next();
    } else {
      res.redirect('/login');
    }
  }
  
  module.exports = ensureAuthenticatedOwner;
  