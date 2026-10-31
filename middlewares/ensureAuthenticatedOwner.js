const ensureAuthenticated = require('./ensureAuthenticated');

function ensureAuthenticatedOwner(req, res, next) {
  return ensureAuthenticated(req, res, error => {
    if (error) return next(error);
    if (req.user.role !== 'owner') return res.status(403).send('Access denied');
    return next();
  });
}

module.exports = ensureAuthenticatedOwner;
  
