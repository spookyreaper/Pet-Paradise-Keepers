const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  pet: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', required: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, required: true, trim: true, maxlength: 3000 },
  location: { type: String, trim: true, maxlength: 120, default: '' },
  startDate: { type: Date, required: true },
  endDate: {
    type: Date, required: true,
    validate: { validator(value) { return !this.startDate || value > this.startDate; }, message: 'End time must be after start time.' },
  },
  budget: {
    type: Number, required: true, min: 0, max: 10000,
    validate: { validator: value => Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, message: 'Use a valid hourly budget with up to two decimal places.' },
  },
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
}, { timestamps: true });

schema.index({ owner: 1, createdAt: -1 });
schema.index({ status: 1, endDate: 1, startDate: 1 });
schema.index({ pet: 1 });

module.exports = mongoose.model('SittingJob', schema);
