function ensureAuthenticatedOwner(req, res, next) {
    // Check if the user is logged in and has the role of 'owner'
    if (req.session.userId && req.session.role === 'owner') {
      next();
    } else {
      res.redirect('/login');
    }
  }
  
  module.exports = ensureAuthenticatedOwner;
  