const Account = require('../models/accountSchema');
const bcrypt = require('bcrypt'); 


function getSitterRegister(req, res) {
  
  res.render('sitterRegister', { errorMessage: null });
}


async function postSitterRegister(req, res) {
  try {
    const { email, password, firstName, lastName, biography, experience, rate } = req.body;
    const hashedPassword = await bcrypt.hash(password, 12); 


    const newSitter = await Account.create({
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role: 'sitter', 
      biography,
      experience,
      rate,
    });

    async function updateSitterProfile(req, res) {
  try {
    const updates = {
      biography: req.body.biography,
      experience: req.body.experience,
      rate: req.body.rate,
    };

    if (req.file) {
      updates.profilePhoto = req.file.path.replace('public/', '');
    }

    await Account.findByIdAndUpdate(req.session.userId, updates, { new: true });
    res.redirect('/sitter/dashboard'); 
  } catch (error) {
    console.error('Error updating sitter profile:', error);
    res.status(500).send('An error occurred while updating sitter profile.');
  }
}

   
    res.redirect('/login');
  } catch (error) {
    console.error('Error registering sitter:', error);
    res.render('sitterRegister', { errorMessage: 'An error occurred during registration.' });
  }
}

async function getSitterProfile(req, res) {
  try {
    const user = await Account.findById(req.session.userId);
    if (!user || user.role !== 'sitter') {
      return res.status(403).send('Access denied');
    }
    res.render('sitter/profile', { user });
  } catch (error) {
    console.error('Error fetching sitter profile:', error);
    res.status(500).send('An error occurred while fetching sitter profile.');
  }
}

async function updateSitterProfile(req, res) {
  try {
    const userId = req.session.userId;
    const user = await Account.findById(userId);

    if (!user) {
      return res.status(404).send('User not found');
    }

    const updates = {
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      biography: req.body.biography,
      experience: req.body.experience,
      rate: req.body.rate,
    };

    if (req.file) {
      updates.profilePhoto = req.file.path.replace('public/', '');
    }

    if (req.body.currentPassword && req.body.newPassword && req.body.confirmNewPassword) {
      const isMatch = await bcrypt.compare(req.body.currentPassword, user.password);
      if (!isMatch) {
        return res.status(400).send('Current password is incorrect');
      }

      if (req.body.newPassword !== req.body.confirmNewPassword) {
        return res.status(400).send('New passwords do not match');
      }

      if (req.body.currentPassword === req.body.newPassword) {
        return res.status(400).send('New password must be different from the current password');
      }

      updates.password = await bcrypt.hash(req.body.newPassword, 10);
    }

    await Account.findByIdAndUpdate(userId, updates, { new: true });
    res.redirect('/sitter/dashboard'); 
  } catch (error) {
    console.error('Error updating sitter profile:', error);
    res.status(500).send('An error occurred while updating sitter profile.');
  }
}



function getCompleteSitterInfo(req, res) {
  const user = req.session.user;
  res.render('completeSitterInfo', { user: user });
}


async function postCompleteSitterInfo(req, res) {
  try {
    const sitterId = req.session.userId;
    const { biography, experience, rate } = req.body;
    const profilePhoto = req.file ? req.file.path.replace('public/', '') : '';

    await Account.findByIdAndUpdate(sitterId, {
      biography,
      experience,
      rate,
      profilePhoto,
    }, { new: true });

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Error updating sitter info:', error);
    res.status(500).send('An error occurred while updating sitter information.');
  }
}

const User = require('../models/accountSchema'); 


async function deleteAccount(req, res) {
  try {
    
    const user = await User.findById(req.session.userId);
    if (!user || user.role !== 'sitter') {
      return res.status(403).send('Access denied');
    }

    await User.findByIdAndDelete(req.session.userId);
    req.session.destroy(() => res.redirect('/login')); 
  } catch (error) {
    console.error('Error deleting sitter account:', error);
    res.status(500).send('An error occurred.');
  }
}


async function deleteAccount(req, res) {
  try {
    const user = await User.findById(req.session.userId);
    if (!user || user.role !== 'sitter') {
      return res.status(403).send('Access denied');
    }

    await User.findByIdAndDelete(req.session.userId);
    req.session.destroy(() => res.redirect('/login')); // Redirect to home or login page
  } catch (error) {
    console.error('Error deleting sitter account:', error);
    res.status(500).send('An error occurred.');
  }
}
module.exports = {
  getSitterRegister,
  postSitterRegister,
  getCompleteSitterInfo,
  postCompleteSitterInfo,
  getSitterProfile,
  updateSitterProfile,
  deleteAccount,
};
