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
    console.error('Login error:', error);
    res.render('login', { title: 'Login', errorMessage: 'An error occurred during login' });
  }
};


const postRegister = async (req, res) => {
  try {
    const { username, email, password, firstName, lastName, role } = req.body;
    
    console.log('Attempting to register user:', username); 

    const existingUser = await User.findOne({
      $or: [{ username: username.toLowerCase().trim() }, { email: email.toLowerCase().trim() }]
    });

    if (existingUser) {
      console.log('Username or email already exists'); 
      return res.render('register', { title: 'Register', errorMessage: 'Username or email already exists', role });
    }

       const hashedPassword = await bcrypt.hash(password, 12); 
    console.log(`Registering user: ${username}, Hash: ${hashedPassword}`); 

    const newUser = await User.create({
      username: username.toLowerCase().trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      role,
    });

    console.log('Registered new user:', newUser); 

    req.session.userId = newUser._id;
    req.session.role = newUser.role;


    const redirectUrl = newUser.role === 'owner' ? '/completeOwnerInfo' : '/sitter/complete-info';
    return res.redirect(redirectUrl);
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).render('register', { title: 'Register', errorMessage: 'An error occurred during registration', role: '' });
  }
};

// In your authController or wherever logout is handled
const logout = (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).send('Could not log out, please try again.');
    }
    res.clearCookie('connect.sid'); // Clear the session cookie if you're using express-session
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
