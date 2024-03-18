
const User = require('../models/accountSchema');
const Pet = require('../models/Pet');
const bcrypt = require('bcrypt');


async function submitOwnerInfo(req, res) {
    try {
        const userId = req.session.userId;
        if (!userId) return res.redirect('/login');

        const { petName, petType, petMedicalHistory } = req.body;
        const petPhoto = req.files['petPhoto'] ? req.files['petPhoto'][0].path.replace('public/', '') : '';
        const ownerPhoto = req.files['ownerPhoto'] ? req.files['ownerPhoto'][0].path.replace('public/', '') : '';

        let petId = null;
        if (petName && petType) {
            const newPet = await Pet.create({
                name: petName,
                type: petType,
                medicalHistory: petMedicalHistory,
                photoUrl: petPhoto,
                owner: userId
            });
            petId = newPet._id;
        }

        await User.findByIdAndUpdate(userId, { 
            $set: { ownerPhoto: ownerPhoto },
            ...(petId && { $push: { pets: petId } })
        });

        res.redirect('/dashboard');
    } catch (error) {
        console.error('Error submitting owner information:', error);
        res.status(500).send('An error occurred.');
    }
}

async function completeOwnerInfo(req, res) {
  if (!req.session || !req.session.userId) {
    console.error('Session or User ID not found');
    return res.status(401).send('You need to be logged in to access this page.');
  }

  try {
    const user = await User.findById(req.session.userId);

    if (!user) {
      console.error(`User with ID ${req.session.userId} not found`);
      return res.status(404).render('error', { message: 'User not found' });
    }

    res.render('completeOwnerInfo', { user });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).render('error', { message: 'An error occurred while fetching user information' });
  }
}
  
async function getOwnerProfile(req, res) {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.redirect('/login');
    }
    if (user.role === 'owner') {
      res.render('owner/profile', { user: user });
    } else {
      res.status(403).send('Access denied');
    }
  } catch (error) {
    console.error('Error fetching user from database:', error);
    res.status(500).render('error', { error: error });
  }
}


async function getEditProfile(req, res) {
  try {
      const user = await User.findById(req.session.userId);
      if (!user) throw new Error('User not found');
      res.render('editProfile', { user });
  } catch (error) {
      console.error('Error fetching user:', error);
      res.status(500).send('An error occurred.');
  }
}



async function updateProfile(req, res) {
  try {
      const userId = req.session.userId;
      const user = await User.findById(userId);

      if (!user) {
          return res.status(404).send('User not found');
      }

      const updates = {
          firstName: req.body.firstName,
          lastName: req.body.lastName,
          email: req.body.email,
      };


      if (req.body.newPassword && req.body.confirmNewPassword && req.body.currentPassword) {
          if (!await user.correctPassword(req.body.currentPassword)) {
              return res.status(400).send('Current password is incorrect');
          }
          if (req.body.newPassword !== req.body.confirmNewPassword) {
              return res.status(400).send('New passwords do not match');
          }
    
          updates.password = await bcrypt.hash(req.body.newPassword, 12);
      }

  
      await User.findByIdAndUpdate(userId, updates);
      res.redirect('/dashboard'); 
  } catch (error) {
      console.error('Error updating user profile:', error);
      res.status(500).send('An error occurred.');
  }
}


async function deleteAccount(req, res) {
  console.log("deleteAccount function called");
  try {
      await User.findByIdAndDelete(req.session.userId);
      req.session.destroy(() => res.redirect('/login'));
  } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).send('An error occurred.');
  }
}



async function addPet(req, res) {
    try {
      if (!req.session.userId) return res.redirect('/login');
      const user = await User.findById(req.session.userId);
      res.render('addPet', { user: user });
    } catch (error) {
      console.error('Error showing add pet form:', error);
      res.status(500).send('An error occurred.');
    }
  }
  

async function processAddPet(req, res) {
    try {
        console.log(`User ID from session: ${req.session.userId}`);
        const { petName, petType, petMedicalHistory } = req.body;
        const petPhoto = req.files && req.files['petPhoto'] ? req.files['petPhoto'][0].path.replace('public/', '') : '';
        console.log(`Pet photo path: ${petPhoto}`);

        const newPet = await Pet.create({
            name: petName,
            type: petType,
            medicationHistory: petMedicalHistory, 
            photoUrl: petPhoto,
            owner: req.session.userId
        });

        await User.findByIdAndUpdate(req.session.userId, { $push: { pets: newPet._id } });

        console.log(`New pet created with ID: ${newPet._id}`);
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Error processing add pet:', error);
        res.status(500).send('An error occurred.');
    }
}

async function getEditPet(req, res) {
  try {
      const petId = req.params.petId;
      const pet = await Pet.findById(petId);
      if (!pet) return res.status(404).send('Pet not found');

      const user = await User.findById(req.session.userId);
      if (!user) return res.status(404).send('User not found');

      res.render('editPet', { pet, user });
  } catch (error) {
      console.error('Error fetching pet:', error);
      res.status(500).send('An error occurred.');
  }
}

async function updatePetInfo(req, res) {
  try {
    const petId = req.params.petId;
    const { name, type, medicalHistory } = req.body;
    const updateData = { name, type, medicalHistory };

    if (req.file) {
      updateData.photoUrl = req.file.path.replace('public/', '');
    }

    await Pet.findByIdAndUpdate(petId, updateData);
    res.redirect('/dashboard');  
  } catch (error) {
    console.error('Error updating pet info:', error);
    res.status(500).send('An error occurred while updating pet information.');
  }
}


async function viewPets(req, res) {
  try {
      const userId = req.session.userId;
      if (!userId) return res.redirect('/login');

      const user = await User.findById(userId).populate('pets');
      if (!user) throw new Error('User not found');

      res.render('viewPets', { pets: user.pets });
  } catch (error) {
      console.error('Error fetching pets:', error);
      res.status(500).send('An error occurred.');
  }
}

async function showPetDetails(req, res) {
  const petId = req.params.petId;
  const pet = await Pet.findById(petId);
  res.render('petDetails', { pet });
}

async function deletePet(req, res) {
  console.log(`Attempting to delete pet with ID: ${req.params.petId}`);
  try {
      const petId = req.params.petId;
      const userId = req.session.userId;

      console.log(`User ${userId} is trying to delete pet ${petId}`);

     
      const pet = await Pet.findOne({ _id: petId, owner: userId });
      if (!pet) {
          console.log("Pet not found or not owned by user");
          return res.status(404).send('Pet not found or not owned by user');
      }

      await Pet.deleteOne({ _id: petId });
      console.log(`Pet ${petId} deleted successfully`);

      
      await User.findByIdAndUpdate(userId, { $pull: { pets: petId } });
      console.log(`Pet reference removed from user ${userId}`);

      res.redirect('/dashboard');
  } catch (error) {
      console.error('Error deleting pet:', error);
      res.status(500).send('An error occurred.');
  }
}


module.exports = {
    submitOwnerInfo,
    getEditProfile,
    updateProfile,
    deleteAccount,
    addPet,
    processAddPet,
    getEditPet,
    updatePetInfo,
    viewPets,
    showPetDetails,
    deletePet,
    completeOwnerInfo, 
    getOwnerProfile,
  };
  
