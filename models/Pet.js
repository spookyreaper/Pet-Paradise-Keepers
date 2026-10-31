const mongoose = require('mongoose');

const petSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: true
  },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  type: { type: String, required: true, trim: true, maxlength: 100 },
  medicationHistory: { type: String, trim: true, maxlength: 5000, default: '' },
  schedule: String,
  photoUrl: String,
});

module.exports = mongoose.model('Pet', petSchema);
