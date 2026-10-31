const mongoose = require('mongoose');

const validRate = value => Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
const rate = {
  type: Number,
  min: [0, 'Hourly rates cannot be negative.'],
  max: [10000, 'Hourly rates cannot exceed $10,000.'],
  validate: { validator: validRate, message: 'Use an hourly rate with no more than two decimal places.' },
};
const historySchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  action: { type: String, enum: ['created', 'offer', 'accepted', 'declined', 'withdrawn'], required: true },
  rate,
  message: { type: String, trim: true, maxlength: 2000, default: '' },
  at: { type: Date, default: Date.now, required: true },
}, { _id: false });

const careRequestSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  sitter: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  pet: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', required: true },
  job: { type: mongoose.Schema.Types.ObjectId, ref: 'SittingJob', default: null, required() { return this.kind === 'job'; } },
  kind: { type: String, enum: ['job', 'interview'], required: true },
  initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  status: { type: String, enum: ['pending', 'accepted', 'declined', 'withdrawn'], default: 'pending', required: true },
  proposedRate: { ...rate, required: true },
  offerBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  message: { type: String, trim: true, maxlength: 2000, default: '' },
  history: { type: [historySchema], default: [] },
}, { timestamps: true });

careRequestSchema.pre('validate', function () {
  const participants = [String(this.owner), String(this.sitter)];
  if (participants[0] === participants[1]) this.invalidate('sitter', 'Choose a different participant.');
  if (!participants.includes(String(this.initiatedBy))) this.invalidate('initiatedBy', 'The initiator must be a participant.');
  if (!participants.includes(String(this.offerBy))) this.invalidate('offerBy', 'The offer must come from a participant.');
  if (this.kind === 'interview' && this.job) this.invalidate('job', 'Direct interviews do not belong to a job listing.');
});

careRequestSchema.index({ owner: 1, sitter: 1, pet: 1, job: 1 }, {
  unique: true,
  partialFilterExpression: { status: 'pending' },
  name: 'unique_pending_request',
});
careRequestSchema.index({ job: 1 }, {
  unique: true,
  partialFilterExpression: { status: 'accepted', kind: 'job' },
  name: 'unique_accepted_job_request',
});
careRequestSchema.index({ owner: 1, updatedAt: -1 });
careRequestSchema.index({ sitter: 1, updatedAt: -1 });

module.exports = mongoose.model('CareRequest', careRequestSchema);
