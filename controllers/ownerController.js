// ownerController.js

const User = require('../models/accountSchema');
const Pet = require('../models/Pet');

// Submit owner information and optionally add a pet
async function submitOwnerInfo(req, res) {
    try {
        const userId = req.session.userId;
        if (!userId) return res.redirect('/login');

        const { petName, petType, petMedicalHistory } = req.body;
        const petPhoto = req.files['petPhoto'] ? req.files['petPhoto'][0].path.replace('public/', '') : '';
        const ownerPhoto = req.files['ownerPhoto'] ? req.files['ownerPhoto'][0].path.replace('public/', '') : '';

        // Create a pet if information is provided
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

        // Update owner's photo and add the new pet to their list of pets
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

// In ownerController.js
async function completeOwnerInfo(req, res) {
  // Check if the user ID is available in the session
  if (!req.session || !req.session.userId) {
    console.error('Session or User ID not found');
    return res.status(401).send('You need to be logged in to access this page.');
  }

  try {
    // Fetch the user based on the session user ID
    const user = await User.findById(req.session.userId);

    // If the user is not found, return a 404 response
    if (!user) {
      console.error(`User with ID ${req.session.userId} not found`);
      return res.status(404).render('error', { message: 'User not found' });
    }

    // Render the completeOwnerInfo view, passing the user data
    res.render('completeOwnerInfo', { user });
  } catch (error) {
    // Log the error and return a 500 response
    console.error('Error fetching user:', error);
    res.status(500).render('error', { message: 'An error occurred while fetching user information' });
  }
}
  

// Display form to edit owner profile
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

// Process update to owner profile
async function updateProfile(req, res) {
    try {
        const { firstName, lastName, email } = req.body;

        // Assuming newPet._id is available in the scope, which typically shouldn't be the case in an update profile function
        const updateObject = {
            firstName,
            lastName,
            email
        };

        if (newPet && newPet._id) {
            updateObject.$push = { pets: newPet._id };
        }

        await User.findByIdAndUpdate(req.session.userId, updateObject);
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).send('An error occurred.');
    }
}


// Delete owner account
async function deleteAccount(req, res) {
    try {
        await User.findByIdAndDelete(req.session.userId);
        req.session.destroy(() => res.redirect('/login'));
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).send('An error occurred.');
    }
}

// Display form to add a new pet
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
  

// Process adding a new pet
async function processAddPet(req, res) {
    try {
        console.log(`User ID from session: ${req.session.userId}`);
        const { petName, petType, petMedicalHistory } = req.body;
        const petPhoto = req.files && req.files['petPhoto'] ? req.files['petPhoto'][0].path.replace('public/', '') : '';
        console.log(`Pet photo path: ${petPhoto}`);

        const newPet = await Pet.create({
            name: petName,
            type: petType,
            medicationHistory: petMedicalHistory, // Make sure this matches your schema
            photoUrl: petPhoto,
            owner: req.session.userId
        });

        // Update the owner's pet array with the new pet's ID
        await User.findByIdAndUpdate(req.session.userId, { $push: { pets: newPet._id } });

        console.log(`New pet created with ID: ${newPet._id}`);
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Error processing add pet:', error);
        res.status(500).send('An error occurred.');
    }
}



// Display form to edit an existing pet
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
    res.redirect('/dashboard');  // Redirect to a page where you can see the update or confirm the update
  } catch (error) {
    console.error('Error updating pet info:', error);
    res.status(500).send('An error occurred while updating pet information.');
  }
}


// Display a list of pets for the owner
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
  // Error handling if pet not found...
  res.render('petDetails', { pet });
}

async function deletePet(req, res) {
  console.log(`Attempting to delete pet with ID: ${req.params.petId}`);
  try {
      const petId = req.params.petId;
      const userId = req.session.userId;

      console.log(`User ${userId} is trying to delete pet ${petId}`);

      // Find the pet to ensure it exists and belongs to the user
      const pet = await Pet.findOne({ _id: petId, owner: userId });
      if (!pet) {
          console.log("Pet not found or not owned by user");
          return res.status(404).send('Pet not found or not owned by user');
      }

      // Delete the pet
      await Pet.deleteOne({ _id: petId });
      console.log(`Pet ${petId} deleted successfully`);

      // Remove the pet reference from the user's 'pets' array
      await User.findByIdAndUpdate(userId, { $pull: { pets: petId } });
      console.log(`Pet reference removed from user ${userId}`);

      // Redirect to the dashboard
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
    completeOwnerInfo, // Add this line
  };
  
