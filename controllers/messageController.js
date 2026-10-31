const mongoose = require('mongoose');
const Account = require('../models/accountSchema');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

const PUBLIC_FIELDS = '_id firstName lastName profilePhoto role';
const PAGE_SIZE = 50;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function currentUser(req, res) {
  if (!req.user) {
    res.redirect('/login');
    return null;
  }
  if (!['owner', 'sitter'].includes(req.user.role)) throw httpError(403, 'Access denied.');
  return req.user;
}

function validId(value, label) {
  if (typeof value !== 'string' || !mongoose.isObjectIdOrHexString(value)) {
    throw httpError(400, `${label} is not valid.`);
  }
  return value.toLowerCase();
}

function messageBody(body) {
  if (typeof body !== 'string') throw httpError(400, 'Write a message before sending.');
  const text = body.trim();
  if (!text) throw httpError(400, 'Write a message before sending.');
  if (text.length > 2000) throw httpError(400, 'Keep your message to 2,000 characters or fewer.');
  return text;
}

function browseUrl(user) {
  return user.role === 'owner' ? '/sitters' : '/jobs';
}

function profileUrl(recipient) {
  return recipient.role === 'sitter' ? `/sitters/${recipient._id}` : `/jobs?owner=${recipient._id}`;
}

function participantFilter(user, conversationId) {
  return { _id: conversationId, [user.role]: user._id };
}

async function recipientPair(user, recipientId) {
  recipientId = validId(recipientId, 'Recipient');
  if (String(user._id) === recipientId) throw httpError(400, 'Choose someone other than yourself.');
  const accounts = await Account.find({ _id: { $in: [user._id, recipientId] } }).select(PUBLIC_FIELDS).lean();
  const sender = accounts.find(account => String(account._id) === String(user._id));
  const recipient = accounts.find(account => String(account._id) === recipientId);
  if (!sender || sender.role !== user.role) throw httpError(404, 'Your account is no longer available.');
  if (!recipient) throw httpError(404, 'This person is no longer available.');
  const oppositeRole = user.role === 'owner' ? 'sitter' : 'owner';
  if (recipient.role !== oppositeRole) throw httpError(400, 'Messages connect a pet owner with a sitter. Choose someone with the other role.');
  const pair = user.role === 'owner'
    ? { owner: user._id, sitter: recipient._id }
    : { owner: recipient._id, sitter: user._id };
  return { pair, recipient };
}

async function accessibleConversation(user, conversationId) {
  validId(conversationId, 'Conversation');
  const conversation = await Conversation.findOne(participantFilter(user, conversationId))
    .populate({ path: 'owner sitter', select: PUBLIC_FIELDS }).lean();
  if (!conversation) throw httpError(404, 'Conversation not found.');
  if (!conversation.owner || !conversation.sitter || conversation.owner.role !== 'owner' || conversation.sitter.role !== 'sitter') {
    throw httpError(404, 'This conversation is no longer available.');
  }
  return { conversation, recipient: conversation[user.role === 'owner' ? 'sitter' : 'owner'] };
}

function isUnread(conversation, user) {
  if (!conversation.lastMessageAt || String(conversation.lastMessage?.sender) === String(user._id)) return false;
  const readAt = conversation[`${user.role}ReadAt`];
  if (!readAt) return true;
  const sentTime = new Date(conversation.lastMessageAt).getTime();
  const readTime = new Date(readAt).getTime();
  if (sentTime !== readTime) return sentTime > readTime;
  const readId = conversation[`${user.role}ReadMessageId`];
  return !readId || String(conversation.lastMessageId) > String(readId);
}

function newerThan(timestampField, idField, message) {
  return [
    { [timestampField]: null },
    { [timestampField]: { $lt: message.createdAt } },
    { [timestampField]: message.createdAt, $or: [{ [idField]: null }, { [idField]: { $lt: message._id } }] },
  ];
}

async function appendMessage(user, conversation, body) {
  const message = await Message.create({ conversation: conversation._id, sender: user._id, body });
  const filter = participantFilter(user, conversation._id);
  const result = await Conversation.updateOne({
    ...filter,
    $or: newerThan('lastMessageAt', 'lastMessageId', message),
  }, { $set: { lastMessage: { body: message.body, sender: user._id }, lastMessageAt: message.createdAt, lastMessageId: message._id } });
  // A newer concurrent message can legitimately win the summary update. A deleted
  // conversation cannot retain a message created by a request that was already in flight.
  if (result.matchedCount === 0 && !await Conversation.exists(filter)) {
    await Message.deleteOne({ _id: message._id, conversation: conversation._id, sender: user._id });
    throw httpError(404, 'This conversation is no longer available.');
  }
  return message;
}

async function threadData(user, conversation, before) {
  const filter = { conversation: conversation._id };
  if (before !== undefined) {
    validId(before, 'Message page');
    const cursor = await Message.findOne({ _id: before, conversation: conversation._id }).select('_id createdAt').lean();
    if (!cursor) throw httpError(400, 'This message page is not available.');
    filter.$or = [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { $lt: cursor._id } }];
  }
  const rows = await Message.find(filter).select('_id sender body createdAt')
    .sort({ createdAt: -1, _id: -1 }).limit(PAGE_SIZE + 1).lean();
  const page = rows.slice(0, PAGE_SIZE);
  const olderCursor = rows.length > PAGE_SIZE ? String(page[page.length - 1]._id) : null;
  if (before === undefined && page[0]) {
    const readAt = `${user.role}ReadAt`;
    const readId = `${user.role}ReadMessageId`;
    await Conversation.updateOne({
      ...participantFilter(user, conversation._id),
      $or: newerThan(readAt, readId, page[0]),
    }, { $set: { [readAt]: page[0].createdAt, [readId]: page[0]._id } });
  }
  return { messages: page.reverse(), olderCursor, isOlderPage: before !== undefined };
}

function renderNew(req, res, user, recipient, errorMessage = null, status = 200) {
  const body = typeof req.body?.body === 'string' ? req.body.body : '';
  const recipientId = recipient ? String(recipient._id) : (typeof req.body?.recipientId === 'string' ? req.body.recipientId : '');
  return res.status(status).render('messages/new', {
    user, recipient, values: { recipientId, body }, errorMessage,
    browseUrl: browseUrl(user), recipientProfileUrl: recipient ? profileUrl(recipient) : null,
  });
}

async function listConversations(req, res, next) {
  try {
    const user = currentUser(req, res);
    if (!user) return;
    const rows = await Conversation.find({ [user.role]: user._id })
      .populate({ path: 'owner sitter', select: PUBLIC_FIELDS }).sort({ lastMessageAt: -1, _id: -1 }).lean();
    const conversations = rows.filter(row => row.owner?.role === 'owner' && row.sitter?.role === 'sitter')
      .map(conversation => ({
        ...conversation, recipient: conversation[user.role === 'owner' ? 'sitter' : 'owner'],
        unread: isUnread(conversation, user),
      }));
    return res.render('messages/index', { user, conversations, browseUrl: browseUrl(user) });
  } catch (error) {
    return next(error);
  }
}

async function getNewConversation(req, res, next) {
  try {
    const user = currentUser(req, res);
    if (!user) return;
    if (req.query.recipient === undefined) return renderNew(req, res, user, null);
    const { pair, recipient } = await recipientPair(user, req.query.recipient);
    const existing = await Conversation.findOne(pair).select('_id').lean();
    if (existing) return res.redirect(`/messages/${existing._id}`);
    return renderNew(req, res, user, recipient);
  } catch (error) {
    return next(error);
  }
}

async function startConversation(req, res, next) {
  let user;
  let recipient;
  try {
    user = currentUser(req, res);
    if (!user) return;
    const result = await recipientPair(user, req.body.recipientId);
    recipient = result.recipient;
    const body = messageBody(req.body.body);
    let conversation;
    try {
      conversation = await Conversation.findOneAndUpdate(result.pair, { $setOnInsert: result.pair }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
    } catch (error) {
      if (error.code !== 11000) throw error;
      conversation = await Conversation.findOne(result.pair).lean();
      if (!conversation) throw error;
    }
    await appendMessage(user, conversation, body);
    return res.redirect(`/messages/${conversation._id}`);
  } catch (error) {
    if (user && [400, 404].includes(error.status)) return renderNew(req, res, user, recipient, error.message, error.status);
    return next(error);
  }
}

async function getConversation(req, res, next) {
  try {
    const user = currentUser(req, res);
    if (!user) return;
    const { conversation, recipient } = await accessibleConversation(user, req.params.conversationId);
    const page = await threadData(user, conversation, req.query.before);
    return res.render('messages/detail', {
      user, conversation, recipient, ...page, errorMessage: null, values: { body: '' }, recipientProfileUrl: profileUrl(recipient),
    });
  } catch (error) {
    return next(error);
  }
}

async function getConversationUpdates(req, res, next) {
  try {
    const user = currentUser(req, res);
    if (!user) return;
    const { conversation, recipient } = await accessibleConversation(user, req.params.conversationId);
    const page = await threadData(user, conversation);
    const senderName = sender => {
      const account = String(sender) === String(conversation.owner._id) ? conversation.owner : conversation.sitter;
      return `${account.firstName} ${account.lastName}`;
    };
    res.set('Cache-Control', 'no-store');
    return res.json({
      messages: page.messages.map(message => ({
        id: String(message._id), body: message.body, senderName: senderName(message.sender),
        isOwn: String(message.sender) === String(user._id), createdAt: new Date(message.createdAt).toISOString(),
      })),
      olderCursor: page.olderCursor,
      counterpart: { firstName: recipient.firstName, lastName: recipient.lastName },
    });
  } catch (error) {
    return next(error);
  }
}

async function sendMessage(req, res, next) {
  let user;
  let conversation;
  let recipient;
  try {
    user = currentUser(req, res);
    if (!user) return;
    ({ conversation, recipient } = await accessibleConversation(user, req.params.conversationId));
    const body = messageBody(req.body.body);
    await appendMessage(user, conversation, body);
    return res.redirect(`/messages/${conversation._id}`);
  } catch (error) {
    if (conversation && error.status === 400) {
      try {
        const page = await threadData(user, conversation);
        return res.status(400).render('messages/detail', {
          user, conversation, recipient, ...page, errorMessage: error.message,
          values: { body: typeof req.body.body === 'string' ? req.body.body : '' }, recipientProfileUrl: profileUrl(recipient),
        });
      } catch (loadError) {
        return next(loadError);
      }
    }
    return next(error);
  }
}

module.exports = { listConversations, getNewConversation, startConversation, getConversation, getConversationUpdates, sendMessage };
