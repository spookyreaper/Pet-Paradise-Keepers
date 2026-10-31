const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const ejs = require('ejs');
const ConversationModel = require('../models/Conversation');
const MessageModel = require('../models/Message');

const ownerId = '111111111111111111111111';
const sitterId = '222222222222222222222222';
const conversationId = '333333333333333333333333';
const earlierId = '444444444444444444444441';
const laterId = '444444444444444444444442';
const firstDate = new Date('2026-10-12T14:00:00.000Z');
const secondDate = new Date('2026-10-12T14:01:00.000Z');
const owner = { _id: ownerId, role: 'owner', firstName: 'Alex', lastName: 'Owner', profilePhoto: '' };
const sitter = { _id: sitterId, role: 'sitter', firstName: 'Sam', lastName: 'Sitter', profilePhoto: '' };
const fixtureMessages = [
  { _id: laterId, conversation: conversationId, sender: sitterId, body: 'Happy to discuss the details.', createdAt: secondDate },
  { _id: earlierId, conversation: conversationId, sender: ownerId, body: 'Hello Sam!', createdAt: firstDate },
];

function setup(role = 'owner', overrides = {}) {
  const calls = {};
  const order = [];
  const user = { ...(role === 'owner' ? owner : sitter) };
  const conversation = {
    _id: conversationId, owner: { ...owner }, sitter: { ...sitter },
    lastMessage: { body: fixtureMessages[0].body, sender: sitterId }, lastMessageAt: secondDate,
    lastMessageId: laterId, ownerReadAt: null, sitterReadAt: null, ownerReadMessageId: null, sitterReadMessageId: null,
  };
  const record = (name, args) => { (calls[name] ||= []).push(args); order.push(name); };
  const value = (name, fallback, args) => overrides[name] ? overrides[name](...args) : (typeof fallback === 'function' ? fallback(...args) : fallback);
  const query = (name, fallback) => (...args) => {
    record(name, args);
    const result = {
      lean() { return Promise.resolve().then(() => value(name, fallback, args)); },
      then(resolve, reject) { return this.lean().then(resolve, reject); },
    };
    for (const method of ['select', 'populate', 'sort', 'limit']) {
      result[method] = (...params) => { record(`${name}.${method}`, params); return result; };
    }
    return result;
  };
  const mutation = (name, fallback) => async (...args) => {
    record(name, args);
    return value(name, fallback, args);
  };
  const accountModel = { find: query('accountFind', [{ ...owner }, { ...sitter }]) };
  const conversationModel = {
    find: query('conversationFind', [conversation]),
    findOne: query('conversationFindOne', conversation),
    findOneAndUpdate: query('upsert', conversation),
    updateOne: mutation('updateOne', { matchedCount: 1 }),
    exists: mutation('exists', { _id: conversationId }),
  };
  const messageModel = {
    find: query('messageFind', fixtureMessages),
    findOne: query('messageFindOne', fixtureMessages[1]),
    create: mutation('createMessage', values => ({ ...values, _id: laterId, createdAt: secondDate })),
    deleteOne: mutation('deleteMessage', { deletedCount: 1 }),
  };
  const controllerPath = require.resolve('../controllers/messageController');
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (parent && parent.filename === controllerPath) {
      if (request === '../models/accountSchema') return accountModel;
      if (request === '../models/Conversation') return conversationModel;
      if (request === '../models/Message') return messageModel;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  let controller;
  try {
    delete require.cache[controllerPath];
    controller = require(controllerPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[controllerPath];
  }
  const req = {
    user, query: {}, params: { conversationId },
    body: { recipientId: role === 'owner' ? sitterId : ownerId, body: ' Hello there! ' },
  };
  const res = {
    statusCode: 200, headers: {},
    status(code) { this.statusCode = code; return this; },
    render(view, locals) { this.view = view; this.locals = locals; return this; },
    redirect(location) { this.location = location; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  const errors = [];
  const invoke = name => controller[name](req, res, error => errors.push(error));
  return { user, conversation, req, res, calls, order, errors, invoke };
}

test('message schema validates required refs, whitespace, and the message size limit', async () => {
  const valid = new MessageModel({ conversation: conversationId, sender: ownerId, body: ' Hello! ' });
  await valid.validate();
  assert.equal(valid.body, 'Hello!');
  for (const values of [
    { sender: ownerId, body: 'Hello' },
    { conversation: conversationId, body: 'Hello' },
    { conversation: conversationId, sender: ownerId, body: '   ' },
    { conversation: conversationId, sender: ownerId, body: 'x'.repeat(2001) },
    { conversation: conversationId, sender: ownerId, body: { $ne: '' } },
  ]) await assert.rejects(new MessageModel(values).validate());
  assert.ok(MessageModel.schema.indexes().some(([fields]) => fields.conversation === 1 && fields.createdAt === -1 && fields._id === -1));
});

test('conversation schema prevents self conversations and indexes each owner/sitter pair uniquely', async () => {
  await new ConversationModel({ owner: ownerId, sitter: sitterId }).validate();
  await assert.rejects(new ConversationModel({ owner: ownerId, sitter: ownerId }).validate(), /two different/);
  assert.ok(ConversationModel.schema.indexes().some(([fields, options]) => fields.owner === 1 && fields.sitter === 1 && options.unique));
});

for (const handler of ['listConversations', 'getNewConversation', 'startConversation', 'getConversation', 'getConversationUpdates', 'sendMessage']) {
  test(`${handler} redirects guests before querying or changing message data`, async () => {
    const { req, res, calls, invoke } = setup();
    req.user = null;
    await invoke(handler);
    assert.equal(res.location, '/login');
    assert.deepEqual(calls, {});
  });
}

for (const role of ['owner', 'sitter']) {
  test(`${role} inbox is participant scoped and populates only public identity fields`, async () => {
    const { user, res, calls, invoke } = setup(role);
    await invoke('listConversations');
    assert.deepEqual(calls.conversationFind[0][0], { [role]: user._id });
    assert.deepEqual(calls['conversationFind.populate'][0][0], { path: 'owner sitter', select: '_id firstName lastName profilePhoto role' });
    assert.equal(res.view, 'messages/index');
    assert.equal(res.locals.conversations[0].recipient.role, role === 'owner' ? 'sitter' : 'owner');
  });

  test(`${role} can initiate one conversation with the opposite role and sends only controlled fields`, async () => {
    const { req, res, calls, invoke } = setup(role);
    req.body.sender = '555555555555555555555555';
    await invoke('startConversation');
    assert.deepEqual(calls.upsert[0][0], { owner: ownerId, sitter: sitterId });
    assert.equal(calls.upsert[0][2].upsert, true);
    assert.deepEqual(calls.createMessage[0][0], { conversation: conversationId, sender: role === 'owner' ? ownerId : sitterId, body: 'Hello there!' });
    assert.equal(res.location, `/messages/${conversationId}`);
    assert.deepEqual(calls['accountFind.select'][0], ['_id firstName lastName profilePhoto role']);
  });
}

test('inbox identifies same-millisecond unread messages and hides conversations with deleted participants', async () => {
  const { conversation, res, invoke } = setup();
  conversation.ownerReadAt = secondDate;
  conversation.ownerReadMessageId = earlierId;
  await invoke('listConversations');
  assert.equal(res.locals.conversations[0].unread, true);
  conversation.ownerReadMessageId = laterId;
  await invoke('listConversations');
  assert.equal(res.locals.conversations[0].unread, false);
  conversation.sitter = null;
  await invoke('listConversations');
  assert.deepEqual(res.locals.conversations, []);
});

test('new-conversation links reuse an existing pair instead of creating another thread', async () => {
  const { req, res, calls, invoke } = setup();
  req.query.recipient = sitterId;
  await invoke('getNewConversation');
  assert.equal(res.location, `/messages/${conversationId}`);
  assert.deepEqual(calls.conversationFindOne[0][0], { owner: ownerId, sitter: sitterId });
  assert.equal(calls.upsert, undefined);
});

test('a new pair gets a compose screen and a public profile link', async () => {
  const { req, res, invoke } = setup('owner', { conversationFindOne: () => null });
  req.query.recipient = sitterId;
  await invoke('getNewConversation');
  assert.equal(res.view, 'messages/new');
  assert.equal(res.locals.recipientProfileUrl, `/sitters/${sitterId}`);
});

test('malformed and self recipients are rejected before account lookup', async () => {
  for (const recipient of [ownerId, 'invalid-id', { $ne: '' }, [sitterId]]) {
    const { req, res, calls, invoke } = setup();
    req.body.recipientId = recipient;
    await invoke('startConversation');
    assert.equal(res.statusCode, 400);
    assert.equal(res.locals.values.body, ' Hello there! ');
    assert.equal(calls.accountFind, undefined);
    assert.equal(calls.createMessage, undefined);
  }
});

test('same-role recipients and deleted accounts cannot receive new conversations', async () => {
  for (const accounts of [[owner, { ...sitter, role: 'owner' }], [owner], [sitter]]) {
    const { res, calls, invoke } = setup('owner', { accountFind: () => accounts });
    await invoke('startConversation');
    assert.ok([400, 404].includes(res.statusCode));
    assert.equal(res.locals.values.body, ' Hello there! ');
    assert.equal(calls.createMessage, undefined);
  }
});

test('invalid compose messages preserve the raw text and never create a thread or message', async () => {
  for (const body of ['', '    ', 'x'.repeat(2001), { $ne: '' }, ['message'], 123]) {
    const { req, res, calls, invoke } = setup();
    req.body.body = body;
    await invoke('startConversation');
    assert.equal(res.statusCode, 400);
    assert.equal(res.view, 'messages/new');
    assert.equal(res.locals.values.body, typeof body === 'string' ? body : '');
    assert.equal(calls.upsert, undefined);
    assert.equal(calls.createMessage, undefined);
  }
});

test('concurrent pair creation recovers a unique-index conflict and appends once', async () => {
  const { calls, res, invoke } = setup('owner', { upsert: () => { throw Object.assign(new Error('Duplicate pair'), { code: 11000 }); } });
  await invoke('startConversation');
  assert.equal(calls.conversationFindOne.length, 1);
  assert.equal(calls.createMessage.length, 1);
  assert.equal(res.location, `/messages/${conversationId}`);
});

for (const handler of ['getConversation', 'getConversationUpdates', 'sendMessage']) {
  test(`${handler} refuses ID tampering before reading any thread messages`, async () => {
    const { calls, errors, invoke } = setup('owner', { conversationFindOne: () => null });
    await invoke(handler);
    assert.deepEqual(calls.conversationFindOne[0][0], { _id: conversationId, owner: ownerId });
    assert.equal(errors[0].status, 404);
    assert.equal(calls.messageFind, undefined);
    assert.equal(calls.createMessage, undefined);
  });
}

test('deleted counterpart records prevent thread reads and sends', async () => {
  const { conversation, calls, errors, invoke } = setup();
  conversation.sitter = null;
  await invoke('sendMessage');
  assert.equal(errors[0].status, 404);
  assert.equal(calls.createMessage, undefined);
});

test('new message summaries use conditional time-and-ID ordering to prevent stale overwrites', async () => {
  const { calls, invoke } = setup();
  await invoke('sendMessage');
  const [filter, update] = calls.updateOne[0];
  assert.equal(filter.owner, ownerId);
  assert.equal(filter._id, conversationId);
  assert.deepEqual(filter.$or[1], { lastMessageAt: { $lt: secondDate } });
  assert.deepEqual(filter.$or[2], { lastMessageAt: secondDate, $or: [{ lastMessageId: null }, { lastMessageId: { $lt: laterId } }] });
  assert.deepEqual(update.$set.lastMessage, { body: 'Hello there!', sender: ownerId });
});

test('a delayed send keeps a newer summary without deleting its own message', async () => {
  const { calls, res, errors, invoke } = setup('owner', { updateOne: () => ({ matchedCount: 0 }) });
  await invoke('sendMessage');
  assert.equal(calls.exists.length, 1);
  assert.equal(calls.deleteMessage, undefined);
  assert.equal(res.location, `/messages/${conversationId}`);
  assert.deepEqual(errors, []);
});

test('a conversation deleted during sending cannot retain the newly written orphan message', async () => {
  const { calls, errors, invoke } = setup('owner', { updateOne: () => ({ matchedCount: 0 }), exists: () => null });
  await invoke('sendMessage');
  assert.deepEqual(calls.deleteMessage[0][0], { _id: laterId, conversation: conversationId, sender: ownerId });
  assert.equal(errors[0].status, 404);
});

test('thread pages load a bounded chronological window and mark only the newest displayed message read', async () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({
    ...fixtureMessages[0], _id: (1000 - index).toString(16).padStart(24, '0'), createdAt: new Date(secondDate.getTime() - index * 1000),
  }));
  const { res, calls, invoke } = setup('owner', { messageFind: () => rows });
  await invoke('getConversation');
  assert.deepEqual(calls.messageFind[0][0], { conversation: conversationId });
  assert.deepEqual(calls['messageFind.limit'][0], [51]);
  assert.equal(res.locals.messages.length, 50);
  assert.equal(res.locals.messages[0]._id, rows[49]._id);
  assert.equal(res.locals.messages[49]._id, rows[0]._id);
  assert.equal(res.locals.olderCursor, rows[49]._id);
  assert.deepEqual(calls.updateOne[0][1].$set, { ownerReadAt: rows[0].createdAt, ownerReadMessageId: rows[0]._id });
});

test('older cursors are conversation scoped and do not mark the latest messages read', async () => {
  const { req, res, calls, invoke } = setup();
  req.query.before = earlierId;
  await invoke('getConversation');
  assert.deepEqual(calls.messageFindOne[0][0], { _id: earlierId, conversation: conversationId });
  assert.deepEqual(calls.messageFind[0][0].$or[1], { createdAt: firstDate, _id: { $lt: earlierId } });
  assert.equal(calls.updateOne, undefined);
  assert.equal(res.locals.isOlderPage, true);
});

test('cursor validation happens only after confirming conversation ownership', async () => {
  const { req, calls, errors, invoke } = setup('owner', { conversationFindOne: () => null });
  req.query.before = { $gt: '' };
  await invoke('getConversation');
  assert.equal(errors[0].status, 404);
  assert.equal(calls.messageFindOne, undefined);
});

test('reply validation retains the draft and existing messages', async () => {
  const { req, res, calls, invoke } = setup();
  req.body.body = 'x'.repeat(2001);
  await invoke('sendMessage');
  assert.equal(res.statusCode, 400);
  assert.equal(res.view, 'messages/detail');
  assert.equal(res.locals.values.body, req.body.body);
  assert.equal(res.locals.messages.length, 2);
  assert.equal(calls.createMessage, undefined);
});

test('updates return no-store chronological public JSON and track read boundaries', async () => {
  const { res, calls, invoke } = setup();
  await invoke('getConversationUpdates');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(res.payload.messages.map(message => message.id), [earlierId, laterId]);
  assert.deepEqual(Object.keys(res.payload.messages[0]).sort(), ['body', 'createdAt', 'id', 'isOwn', 'senderName']);
  assert.equal(res.payload.messages[0].isOwn, true);
  assert.equal(res.payload.messages[1].senderName, 'Sam Sitter');
  assert.equal(res.payload.counterpart.email, undefined);
  assert.equal(res.payload.counterpart.password, undefined);
  assert.equal(calls.updateOne.length, 1);
});

test('genuine database failures propagate to the shared error handler', async () => {
  const failure = new Error('Database unavailable');
  const { res, errors, invoke } = setup('owner', { createMessage: () => { throw failure; } });
  await invoke('sendMessage');
  assert.equal(errors[0], failure);
  assert.equal(res.view, undefined);
});

test('message views escape private text and keep normal HTML post forms working', async () => {
  const payload = '<script>alert("unsafe")</script>';
  const recipient = { ...sitter, firstName: payload };
  const common = {
    user: owner, recipient, conversation: { _id: conversationId },
    messages: [{ ...fixtureMessages[0], body: payload }], olderCursor: earlierId, isOlderPage: false,
    values: { recipientId: sitterId, body: payload }, errorMessage: null,
    recipientProfileUrl: `/sitters/${sitterId}`, browseUrl: '/sitters',
    conversations: [{ _id: conversationId, recipient, unread: true, lastMessage: { body: payload, sender: sitterId }, lastMessageAt: secondDate }],
  };
  for (const name of ['index', 'new', 'detail']) {
    const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'messages', `${name}.ejs`), common);
    assert.doesNotMatch(html, /<script>alert\("unsafe"\)<\/script>/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /id="main-content"/);
    if (name === 'new') assert.match(html, /action="\/messages\/start" method="post"/);
    if (name === 'detail') {
      assert.match(html, new RegExp(`action="/messages/${conversationId}" method="post"`));
      assert.match(html, /data-message-id=/);
      assert.match(html, /data-message-older="false"/);
    }
  }
});

function pollingHarness({ older = false, visibility = 'visible' } = {}) {
  const events = {};
  const calls = { fetch: [], replaced: [], intervals: [] };
  const status = { hidden: true, textContent: '' };
  const olderLink = { hidden: true, href: '' };
  const emptyMessage = { hidden: false };
  function element(tag) {
    return { tag, dataset: {}, children: [], append(...nodes) { this.children.push(...nodes); } };
  }
  const thread = {
    dataset: { messageOlder: older ? 'true' : 'false', messageUpdates: `/messages/${conversationId}/updates` },
    scrollTop: 0, scrollHeight: 500, clientHeight: 100,
    querySelectorAll: () => [{ dataset: { messageId: earlierId } }],
    replaceChildren(fragment) { calls.replaced.push(fragment.children); },
  };
  const document = {
    visibilityState: visibility,
    querySelector(selector) { return selector === '[data-message-thread]' ? thread : selector === '[data-message-status]' ? status : selector === '[data-message-empty]' ? emptyMessage : olderLink; },
    addEventListener(name, fn) { events[name] = fn; },
    createElement: element,
    createDocumentFragment: () => element('fragment'),
  };
  const window = { addEventListener(name, fn) { events[name] = fn; } };
  let finishFetch;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/messages.js'), 'utf8'), {
    document, window, Intl, Date, AbortController,
    fetch(url, options) { calls.fetch.push([url, options]); return new Promise(resolve => { finishFetch = resolve; }); },
    setInterval(fn, duration) { calls.intervals.push([fn, duration]); return 7; },
    clearInterval(id) { calls.clearedInterval = id; },
    setTimeout: () => 8, clearTimeout() {},
  });
  return { calls, events, document, thread, status, olderLink, emptyMessage, finish(payload) { finishFetch({ ok: true, json: async () => payload }); } };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('polling is disabled on older-message pages and while the document is hidden', () => {
  const older = pollingHarness({ older: true });
  assert.equal(older.calls.intervals.length, 0);
  const hidden = pollingHarness({ visibility: 'hidden' });
  hidden.calls.intervals[0][0]();
  assert.equal(hidden.calls.fetch.length, 0);
});

test('polling uses one request, discards stale hidden-page responses, and cleans up on page exit', async () => {
  const context = pollingHarness();
  assert.equal(context.calls.intervals[0][1], 5000);
  context.calls.intervals[0][0]();
  context.calls.intervals[0][0]();
  assert.equal(context.calls.fetch.length, 1);
  context.document.visibilityState = 'hidden';
  context.events.visibilitychange();
  context.finish({ messages: [{ id: laterId, senderName: 'Sam', body: 'Message', isOwn: false, createdAt: secondDate.toISOString() }] });
  await flush();
  assert.equal(context.calls.replaced.length, 0);
  context.events.pagehide();
  assert.equal(context.calls.clearedInterval, 7);
});

test('returning to a cached thread restarts polling after page-exit cleanup', () => {
  const context = pollingHarness();
  context.events.pagehide();
  context.events.pageshow();
  assert.equal(context.calls.intervals.length, 2);
  assert.equal(context.calls.fetch.length, 1);
  context.events.pagehide();
  assert.equal(context.calls.clearedInterval, 7);
});

test('polling catches delayed insertion by the full ID list and safely writes text without moving readers to the bottom', async () => {
  const context = pollingHarness();
  context.thread.scrollTop = 20;
  context.calls.intervals[0][0]();
  const payload = '<img src=x onerror=alert(1)>';
  context.finish({ messages: [
    { id: laterId, senderName: payload, body: payload, isOwn: false, createdAt: firstDate.toISOString() },
    { id: earlierId, senderName: 'Alex', body: 'Original', isOwn: true, createdAt: secondDate.toISOString() },
  ], olderCursor: laterId });
  await flush();
  assert.equal(context.calls.replaced.length, 1);
  const message = context.calls.replaced[0][0];
  assert.equal(message.children[0].children[1].textContent, payload);
  assert.equal(message.children[0].children[0].children[0].textContent, payload);
  assert.equal(context.thread.scrollTop, 20);
  assert.equal(context.olderLink.hidden, false);
  assert.equal(context.emptyMessage.hidden, true);
  assert.equal(context.olderLink.href, `/messages/${conversationId}?before=${laterId}`);
  assert.equal(context.calls.fetch[0][1].cache, 'no-store');
});
