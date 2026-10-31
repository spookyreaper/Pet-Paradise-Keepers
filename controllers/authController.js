const User = require('../models/accountSchema');
const bcrypt = require('bcrypt');
const { startSession, destroySession } = require('../utils/session');

const textField = value => typeof value === 'string' ? value.trim() : '';

function registrationValues(body = {}) {
  return {
    username: textField(body.username).toLowerCase(),
    email: textField(body.email).toLowerCase(),
    firstName: textField(body.firstName),
    lastName: textField(body.lastName),
    role: ['owner', 'sitter'].includes(body.role) ? body.role : '',
  };
}

function registrationError(values, password) {
  if (!values.username || !values.email || !values.firstName || !values.lastName) {
    return 'Please complete all required fields.';
  }
  if (values.username.includes('@')) return 'Choose a username without an @ sign.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return 'Please provide a valid email address.';
  if (!values.role) return 'Please select owner or sitter.';
  if (typeof password !== 'string' || password.length < 6) return 'Password must be at least 6 characters.';
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Password must be no more than 72 bytes.';
  return null;
}

const getLogin = (req, res) => {
  if (req.session?.userId) return res.redirect('/dashboard');
  res.render('login', { title: 'Login', errorMessage: null });
};

const getRegister = (req, res) => {
  if (req.session?.userId) return res.redirect('/dashboard');
  const role = ['owner', 'sitter'].includes(req.query?.role) ? req.query.role : '';
  res.render('register', { title: 'Register', errorMessage: null, role });
};

const postLogin = async (req, res, next) => {
  try {
    const username = textField(req.body?.username).toLowerCase();
    const password = req.body?.password;
    if (!username || typeof password !== 'string' || !password) {
      return res.status(400).render('login', { title: 'Login', username, errorMessage: 'Please enter your username or email and password.' });
    }

    const user = await User.findOne({
      $or: [
        { username },
        { email: username }
      ]
    });

    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).render('login', { title: 'Login', username, errorMessage: 'Invalid username or password.' });
    }
    await startSession(req, user);
    return res.redirect('/dashboard');
  } catch (error) {
    return next(error);
  }
};

const postRegister = async (req, res, next) => {
  const values = registrationValues(req.body);
  try {
    const password = req.body?.password;
    const errorMessage = registrationError(values, password);
    if (errorMessage) {
      return res.status(400).render('register', { title: 'Register', ...values, errorMessage });
    }

    const existingUser = await User.findOne({
      $or: [{ username: values.username }, { email: values.email }, { email: values.username }, { username: values.email }]
    });

    if (existingUser) {
      return res.status(409).render('register', { title: 'Register', ...values, errorMessage: 'Username or email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newUser = await User.create({
      ...values,
      password: hashedPassword,
    });

    await startSession(req, newUser);

    const redirectUrl = newUser.role === 'owner' ? '/completeOwnerInfo' : '/sitter/complete-info';
    return res.redirect(redirectUrl);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).render('register', { title: 'Register', ...values, errorMessage: 'Username or email already exists.' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).render('register', { title: 'Register', ...values, errorMessage: 'Please check your registration details.' });
    }
    return next(error);
  }
};

const logout = async (req, res, next) => {
  try {
    await destroySession(req, res);
    return res.redirect('/login');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getLogin,
  getRegister,
  postLogin,
  postRegister,
  logout,
};
