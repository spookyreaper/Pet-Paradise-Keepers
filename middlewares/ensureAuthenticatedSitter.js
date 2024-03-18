function ensureAuthenticatedSitter(req, res, next) {
    if (req.session.userId && req.session.role === 'sitter') {
      next();
    } else {
      res.redirect('/login');
    }
  }
  
  module.exports = ensureAuthenticatedSitter;
  