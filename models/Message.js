const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  body: {
    type: String,
    required: [true, 'Write a message before sending.'],
    trim: true,
    maxlength: [2000, 'Keep your message to 2,000 characters or fewer.'],
  },
}, { timestamps: true });

messageSchema.index({ conversation: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model('Message', messageSchema);
