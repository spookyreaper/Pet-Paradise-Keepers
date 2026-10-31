const SittingJob = require('../models/SittingJob');
const CareRequest = require('../models/CareRequest');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

async function removePetMarketplaceData(petId) {
  await CareRequest.deleteMany({ pet: petId });
  await SittingJob.deleteMany({ pet: petId });
}

async function removeAccountMarketplaceData(userId) {
  const participant = { $or: [{ owner: userId }, { sitter: userId }] };
  await CareRequest.deleteMany(participant);
  await SittingJob.deleteMany({ owner: userId });
  const conversations = await Conversation.find(participant).select('_id').lean();
  await Conversation.deleteMany(participant);
  if (conversations.length) await Message.deleteMany({ conversation: { $in: conversations.map(conversation => conversation._id) } });
}

module.exports = { removePetMarketplaceData, removeAccountMarketplaceData };
