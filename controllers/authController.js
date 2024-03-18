const User = require('../models/accountSchema');
const bcrypt = require('bcrypt');

const getLogin = (req, res) => {
  res.render('login', { title: 'Login', errorMessage: null });
};

const getRegister = (req, res) => {
  res.render('register', { title: 'Register', errorMessage: null, role: '' });
};

const postLogin = async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({
      $or: [
        { username: username.toLowerCase().trim() },
        { email: username.toLowerCase().trim() }
      ]
    });

    if (!user) {
      return res.render('login', { title: 'Login', errorMessage: 'User not found' });
    }
    
    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (isPasswordMatch) {
      req.session.userId = user._id;
      req.session.role = user.role;
      return res.redirect('/dashboard');
    } else {
      return res.render('login', { title: 'Login', errorMessage: 'Invalid password' });
    }
  } catch (error) {
    res.render('login', { title: 'Login', errorMessage: 'An error occurred during login' });
  }
};

const postRegister = async (req, res) => {
  try {
    const { username, email, password, firstName, lastName, role } = req.body;

    const existingUser = await User.findOne({
      $or: [{ username: username.toLowerCase().trim() }, { email: email.toLowerCase().trim() }]
    });

    if (existingUser) {
      return res.render('register', { title: 'Register', errorMessage: 'Username or email already exists', role });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newUser = await User.create({
      username: username.toLowerCase().trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      role,
    });

    req.session.userId = newUser._id;
    req.session.role = newUser.role;

    const redirectUrl = newUser.role === 'owner' ? '/completeOwnerInfo' : '/sitter/complete-info';
    return res.redirect(redirectUrl);
  } catch (error) {
    res.status(500).render('register', { title: 'Register', errorMessage: 'An error occurred during registration', role: '' });
  }
};

const logout = (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).send('Could not log out, please try again.');
    }
    res.clearCookie('connect.sid');
    return res.redirect('/login');
  });
};

module.exports = {
  getLogin,
  getRegister,
  postLogin,
  postRegister,
  logout,
};
