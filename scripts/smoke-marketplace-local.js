// This smoke test creates and removes its own database on the local development MongoDB.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const session = require('express-session');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { dateInput } = require('../utils/dates');
const Account = require('../models/accountSchema');
const Pet = require('../models/Pet');
const SittingJob = require('../models/SittingJob');
const CareRequest = require('../models/CareRequest');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

const database = `ppk_marketplace_smoke_${randomBytes(8).toString('hex')}`;
const store = new session.MemoryStore();
let server;

async function check(response, status, label) {
  if (response.status !== status) throw new Error(`${label}: expected ${status}, got ${response.status}. ${(await response.text()).replace(/<[^>]*>/g, ' ').slice(-500)}`);
  return response;
}

async function run() {
  await mongoose.connect(`mongodb://127.0.0.1:27018/${database}`, { serverSelectionTimeoutMS: 10000 });
  const app = createApp({ sessionStore: store, sessionSecret: 'isolated-local-marketplace-smoke-secret' });
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (url, method = 'GET', values) => {
      const response = await fetch(`${base}${url}`, {
        method, redirect: 'manual', signal: AbortSignal.timeout(10000),
        headers: { ...(cookie ? { cookie } : {}), ...(values ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        ...(values ? { body: new URLSearchParams(values) } : {}),
      });
      const sessionCookie = response.headers.get('set-cookie');
      if (sessionCookie) cookie = sessionCookie.split(';')[0];
      return response;
    };
  };
  const owner = client(); const sitter = client(); const stranger = client(); const guest = client();
  const accounts = [];
  for (const [request, username, role] of [[owner, 'smoke-owner', 'owner'], [sitter, 'smoke-sitter', 'sitter'], [stranger, 'smoke-stranger', 'owner']]) {
    await check(await request('/register', 'POST', { username, email: `${username}@example.test`, password: 'test-password-local', firstName: username, lastName: 'Test', role }), 302, `${role} registration`);
    accounts.push(await Account.findOne({ username }));
  }
  const [ownerAccount, sitterAccount] = accounts;
  await check(await sitter('/sitter/complete-info', 'POST', { biography: 'Calm and thoughtful care.', experience: 'Cats and dogs.', rate: '35.50' }), 302, 'sitter completion');
  await check(await owner('/pets/add', 'POST', { name: 'Mochi', type: 'Cat', medicationHistory: 'PRIVATE-MEDICAL-HISTORY-DO-NOT-PUBLISH' }), 302, 'pet creation');
  const pet = await Pet.findOne({ owner: ownerAccount._id });
  await check(await owner('/jobs', 'POST', {
    petId: String(pet._id), title: 'A weekend for Mochi', description: 'Two meals and some playtime.', location: 'Brooklyn',
    startDate: dateInput(Date.now() + 86400000 * 3), endDate: dateInput(Date.now() + 86400000 * 4), budget: '25.00',
  }), 302, 'job publication');
  const job = await SittingJob.findOne({ owner: ownerAccount._id });
  assert.ok(job);
  const board = await (await check(await sitter('/jobs'), 200, 'job discovery')).text();
  assert.match(board, /A weekend for Mochi/);
  assert.doesNotMatch(board, /PRIVATE-MEDICAL/);
  const directory = await (await check(await owner('/sitters?maxRate=40'), 200, 'sitter discovery')).text();
  assert.match(directory, /35\.50/);
  assert.doesNotMatch(directory, /smoke-sitter@example\.test/);
  await check(await stranger(`/jobs/${job._id}`), 404, 'other-owner job privacy');
  await check(await guest('/jobs'), 302, 'guest job protection');
  await check(await owner(`/jobs/${job._id}/request`), 403, 'job application role protection');

  await check(await sitter(`/jobs/${job._id}/requests`, 'POST', { proposedRate: '30', message: 'I would love to help.' }), 302, 'job application');
  let request = await CareRequest.findOne({ job: job._id });
  await check(await sitter(`/jobs/${job._id}/requests`, 'POST', { proposedRate: '30', message: 'Duplicate' }), 409, 'duplicate application');
  await check(await stranger(`/requests/${request._id}`), 404, 'private request');
  await check(await owner(`/requests/${request._id}/offers`, 'POST', { expectedVersion: '0', proposedRate: '28', message: 'Would $28 work?' }), 302, 'owner counteroffer');
  await check(await sitter(`/requests/${request._id}/respond`, 'POST', { expectedVersion: '0', action: 'accept' }), 409, 'outdated offer protection');
  await check(await sitter(`/requests/${request._id}/respond`, 'POST', { expectedVersion: '1', action: 'accept' }), 302, 'job agreement');
  request = await CareRequest.findById(request._id);
  assert.equal(request.status, 'accepted'); assert.equal(request.proposedRate, 28);
  assert.equal((await SittingJob.findById(job._id)).status, 'closed');
  await assert.rejects(CareRequest.create({ owner: ownerAccount._id, sitter: new mongoose.Types.ObjectId(), pet: pet._id, job: job._id,
    kind: 'job', status: 'accepted', initiatedBy: ownerAccount._id, offerBy: ownerAccount._id, proposedRate: 28 }), error => error.code === 11000);

  await check(await owner(`/sitters/${sitterAccount._id}/requests`, 'POST', { petId: String(pet._id), proposedRate: '32', message: 'Can we meet first?' }), 302, 'interview request');
  const interview = await CareRequest.findOne({ kind: 'interview' });
  await check(await sitter(`/requests/${interview._id}/offers`, 'POST', { expectedVersion: '0', proposedRate: '33', message: 'My interview offer.' }), 302, 'sitter counteroffer');
  await check(await owner(`/requests/${interview._id}/respond`, 'POST', { expectedVersion: '1', action: 'accept' }), 302, 'interview acceptance');
  assert.equal((await CareRequest.findById(interview._id)).status, 'accepted');
  for (const action of ['withdraw', 'decline']) {
    await check(await owner(`/sitters/${sitterAccount._id}/requests`, 'POST', { petId: String(pet._id), proposedRate: '31' }), 302, 'new pending interview');
    const pending = await CareRequest.findOne({ kind: 'interview', status: 'pending' });
    await check(await (action === 'withdraw' ? owner : sitter)(`/requests/${pending._id}/respond`, 'POST', { expectedVersion: '0', action }), 302, action);
    assert.equal((await CareRequest.findById(pending._id)).status, action === 'withdraw' ? 'withdrawn' : 'declined');
  }

  const privateText = '<script>private-test-message</script>';
  await check(await owner('/messages/start', 'POST', { recipientId: String(sitterAccount._id), body: privateText }), 302, 'private conversation');
  const conversation = await Conversation.findOne({ owner: ownerAccount._id, sitter: sitterAccount._id });
  await check(await sitter('/messages/start', 'POST', { recipientId: String(ownerAccount._id), body: 'Thanks for reaching out.' }), 302, 'reused conversation');
  assert.equal(await Conversation.countDocuments({ owner: ownerAccount._id, sitter: sitterAccount._id }), 1);
  assert.match(await (await owner('/messages')).text(), /Unread/);
  const thread = await (await check(await owner(`/messages/${conversation._id}`), 200, 'message thread')).text();
  assert.match(thread, /&lt;script&gt;private-test-message&lt;\/script&gt;/);
  assert.doesNotMatch(thread, /<script>private-test-message<\/script>/);
  await check(await stranger(`/messages/${conversation._id}`), 404, 'private thread');
  await check(await stranger(`/messages/${conversation._id}/updates`), 404, 'private polling');
  await check(await stranger(`/messages/${conversation._id}`, 'POST', { body: 'Intrusion' }), 404, 'private replies');
  const updates = await check(await owner(`/messages/${conversation._id}/updates`), 200, 'live updates');
  assert.equal(updates.headers.get('cache-control'), 'no-store');
  const data = await updates.json();
  assert.equal(data.messages.length, 2);
  assert.equal(data.messages[0].body, privateText);
  assert.doesNotMatch(JSON.stringify(data), /password|example\.test/);
  await check(await owner(`/messages/${conversation._id}`, 'POST', { body: '' }), 400, 'invalid message');
  assert.equal(await Message.countDocuments({ conversation: conversation._id }), 2);
  await check(await sitter(`/messages/${conversation._id}`, 'POST', { body: 'A follow-up message.' }), 302, 'private reply');
  assert.equal((await (await owner(`/messages/${conversation._id}/updates`)).json()).messages.length, 3);

  await check(await owner('/owner/profile/delete?_method=DELETE', 'POST', {}), 302, 'account cleanup');
  assert.equal(await SittingJob.countDocuments({ owner: ownerAccount._id }), 0);
  assert.equal(await CareRequest.countDocuments({ owner: ownerAccount._id }), 0);
  assert.equal(await Conversation.countDocuments({ owner: ownerAccount._id }), 0);
  assert.equal(await Message.countDocuments({ conversation: conversation._id }), 0);
  console.log('Live local marketplace smoke test passed: jobs, sitter discovery, interviews, rate negotiation, duplicate/stale-request protection, private messages, live updates, and account cleanup.');
}

run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  store.clear();
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
