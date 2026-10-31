const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  sitter: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  lastMessage: {
    body: { type: String, default: '', maxlength: 2000 },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
  },
  lastMessageAt: { type: Date, default: null },
  lastMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  ownerReadAt: { type: Date, default: null },
  sitterReadAt: { type: Date, default: null },
  ownerReadMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  sitterReadMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
}, { timestamps: true });

conversationSchema.index({ owner: 1, sitter: 1 }, { unique: true });
conversationSchema.index({ owner: 1, lastMessageAt: -1, _id: -1 });
conversationSchema.index({ sitter: 1, lastMessageAt: -1, _id: -1 });
conversationSchema.pre('validate', function () {
  if (this.owner && this.sitter && String(this.owner) === String(this.sitter)) {
    this.invalidate('sitter', 'A conversation needs two different accounts.');
  }
});

module.exports = mongoose.model('Conversation', conversationSchema);
