const mongoose = require('mongoose');
const bcrypt = require('bcrypt');


const accountSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Please provide a username'],
    unique: true,
    lowercase: true, 
    trim: true 
  },
  email: {
    type: String,
    required: [true, 'Please provide an email address'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/\S+@\S+\.\S+/, 'Please provide a valid email address'] 
  },  
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: 6 
  },
  firstName: {
    type: String,
    required: [true, 'Please provide your first name'],
    trim: true
  },
  lastName: {
    type: String,
    required: [true, 'Please provide your last name'],
    trim: true
  },
  role: {
    type: String,
    enum: ['owner', 'sitter'], 
    required: true
  },
  biography: {
    type: String,
    default: ''
  },
  experience: {
    type: String,
    default: ''
  },
  rate: {
    type: Number,
    default: 0
  },
  profilePhoto: {
    type: String,
    default: ''
  },
  pets: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Pet'
  }]
}, { timestamps: true }); 





accountSchema.methods.correctPassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};


accountSchema.index({ username: 1, email: 1 });

const Account = mongoose.model('Account', accountSchema);
module.exports = Account;
