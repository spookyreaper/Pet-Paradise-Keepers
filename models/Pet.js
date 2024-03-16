const mongoose = require('mongoose');

const petSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: true
  },
  name: { type: String, required: true },
  type: { type: String, required: true },
  medicationHistory: String,
  schedule: String,
  photoUrl: String,
});

const Pet = mongoose.model('Pet', petSchema);

module.exports = Pet;
