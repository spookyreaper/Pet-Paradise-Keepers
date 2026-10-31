function regenerate(session) {
  return new Promise((resolve, reject) => {
    session.regenerate(error => error ? reject(error) : resolve());
  });
}

async function startSession(req, user) {
  await regenerate(req.session);
  req.session.userId = String(user._id);
  req.session.role = user.role;
  await new Promise((resolve, reject) => {
    req.session.save(error => error ? reject(error) : resolve());
  });
}

async function destroySession(req, res) {
  if (req.session) {
    await new Promise((resolve, reject) => {
      req.session.destroy(error => error ? reject(error) : resolve());
    });
  }
  res.clearCookie('connect.sid', { path: '/' });
}

module.exports = { startSession, destroySession };
