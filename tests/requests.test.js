const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const ejs = require('ejs');

const owner = { _id: '111111111111111111111111', role: 'owner', firstName: 'Alex', lastName: 'Owner' };
const sitter = { _id: '222222222222222222222222', role: 'sitter', firstName: 'Sam', lastName: 'Sitter', rate: 20 };
const pet = { _id: '333333333333333333333333', owner: owner._id, name: 'Milo', type: 'Dog', photoUrl: '' };
const job = { _id: '444444444444444444444444', owner: owner._id, pet: pet._id, title: 'Weekend care', location: 'Boston', description: 'Walks and company', budget: 25, endDate: new Date(Date.now() + 86400000), status: 'open' };
const requestId = '555555555555555555555555';

function setup(overrides = {}, requestValues = {}) {
  const stored = {
    _id: requestId, owner, sitter, pet, job: null, kind: 'interview', initiatedBy: owner._id,
    offerBy: owner._id, proposedRate: 20, status: 'pending', message: 'Can we meet?', history: [], __v: 0,
    ...requestValues,
  };
  const calls = {};
  function query(value) {
    return {
      select(fields) { (calls.selections ||= []).push(fields); return this; },
      populate(fields) { (calls.populations ||= []).push(fields); return this; },
      sort(fields) { (calls.sorts ||= []).push(fields); return this; },
      then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
    };
  }
  const track = (name, fallback, isQuery = false) => (...args) => {
    (calls[name] ||= []).push(args);
    let value;
    try { value = overrides[name] ? overrides[name](...args) : typeof fallback === 'function' ? fallback(...args) : fallback; }
    catch (error) { value = Promise.reject(error); }
    return isQuery ? query(value) : Promise.resolve(value);
  };
  const requestModel = {
    findOne: track('request.findOne', () => stored, true),
    find: track('request.find', [stored], true),
    create: track('request.create', values => ({ _id: requestId, ...values })),
    findOneAndUpdate: track('request.update', (filter, update) => {
      if (filter.__v !== stored.__v || filter.status !== stored.status) return null;
      Object.assign(stored, update.$set);
      stored.__v += update.$inc?.__v || 0;
      if (update.$push) stored.history.push(update.$push.history);
      if (update.$pop) stored.history.pop();
      return stored;
    }),
  };
  const accounts = {
    findOne: track('account.findOne', filter => filter.role === 'sitter' ? sitter : owner, true),
    exists: track('account.exists', true),
  };
  const pets = {
    find: track('pet.find', [pet], true),
    findOne: track('pet.findOne', pet, true),
    exists: track('pet.exists', true),
  };
  const jobs = {
    findOne: track('job.findOne', job, true),
    exists: track('job.exists', true),
    updateOne: track('job.updateOne', { matchedCount: 1 }),
  };
  const controllerPath = require.resolve('../controllers/requestController');
  const original = Module._load;
  Module._load = function (name, parent, isMain) {
    if (parent?.filename === controllerPath) {
      if (name === '../models/CareRequest') return requestModel;
      if (name === '../models/SittingJob') return jobs;
      if (name === '../models/accountSchema') return accounts;
      if (name === '../models/Pet') return pets;
    }
    return original.call(this, name, parent, isMain);
  };
  let controller;
  try { delete require.cache[controllerPath]; controller = require(controllerPath); }
  finally { Module._load = original; delete require.cache[controllerPath]; }
  const req = {
    user: owner, params: { sitterId: sitter._id, jobId: job._id, requestId },
    body: { petId: pet._id, proposedRate: '23.50', message: 'Hello!', expectedVersion: '0', action: 'accept' },
  };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    render(view, locals) { this.view = view; this.locals = locals; return this; },
    redirect(location) { this.location = location; return this; },
  };
  const errors = [];
  const invoke = handler => controller[handler](req, res, error => errors.push(error));
  return { req, res, stored, calls, errors, invoke };
}

test('an owner creates an interview using only their own pet and a real sitter', async () => {
  const { req, res, calls, invoke } = setup();
  req.body.owner = sitter._id;
  await invoke('createInterviewRequest');
  const created = calls['request.create'][0][0];
  assert.equal(created.owner, owner._id);
  assert.equal(created.sitter, sitter._id);
  assert.equal(created.pet, pet._id);
  assert.equal(created.job, null);
  assert.equal(created.proposedRate, 23.5);
  assert.equal(created.initiatedBy, owner._id);
  assert.equal(created.history[0].action, 'created');
  assert.deepEqual(calls['pet.findOne'][0][0], { _id: pet._id, owner: owner._id });
  assert.equal(res.location, `/requests/${requestId}`);
});

test('an interview cannot target a pet belonging to someone else', async () => {
  const { res, calls, invoke } = setup({ 'pet.findOne': () => null });
  await invoke('createInterviewRequest');
  assert.equal(res.statusCode, 400);
  assert.equal(res.view, 'requests/new');
  assert.equal(calls['request.create'], undefined);
  assert.match(res.locals.errorMessage, /your pets/);
});

test('a sitter requests a still-open job using the job’s actual owner and pet', async () => {
  const { req, calls, res, invoke } = setup();
  req.user = sitter;
  req.body.petId = '999999999999999999999999';
  await invoke('createJobRequest');
  const created = calls['request.create'][0][0];
  assert.equal(created.kind, 'job');
  assert.equal(created.job, job._id);
  assert.equal(created.pet, pet._id);
  assert.equal(created.owner, owner._id);
  assert.equal(created.sitter, sitter._id);
  assert.equal(created.offerBy, sitter._id);
  assert.equal(calls['job.findOne'][0][0].status, 'open');
  assert.ok(calls['job.findOne'][0][0].endDate.$gt instanceof Date);
  assert.equal(calls['job.exists'].length, 1);
  assert.equal(res.location, `/requests/${requestId}`);
});

test('a job closed during application is rechecked before creating a request', async () => {
  const { req, res, calls, invoke } = setup({ 'job.exists': () => false });
  req.user = sitter;
  await invoke('createJobRequest');
  assert.equal(res.statusCode, 409);
  assert.equal(calls['request.create'], undefined);
});

for (const rate of ['', '-1', '5.123', 'Infinity', '10000.01', '1e2', ['15']]) {
  test(`invalid hourly rate ${JSON.stringify(rate)} preserves the request form`, async () => {
    const { req, res, calls, invoke } = setup();
    req.body.proposedRate = rate;
    await invoke('createInterviewRequest');
    assert.equal(res.statusCode, 400);
    assert.equal(res.view, 'requests/new');
    assert.equal(res.locals.values.message, 'Hello!');
    assert.equal(calls['request.create'], undefined);
  });
}

test('duplicate pending requests produce a helpful conflict instead of a database error', async () => {
  const { res, errors, invoke } = setup({ 'request.create': () => { throw Object.assign(new Error('duplicate'), { code: 11000 }); } });
  await invoke('createInterviewRequest');
  assert.equal(res.statusCode, 409);
  assert.match(res.locals.errorMessage, /already have a pending request/);
  assert.deepEqual(errors, []);
});

test('request lists and details are restricted to the current participant and safe selections', async () => {
  const { calls, invoke } = setup();
  await invoke('listRequests');
  await invoke('getRequest');
  assert.deepEqual(calls['request.find'][0][0], { $or: [{ owner: owner._id }, { sitter: owner._id }] });
  assert.deepEqual(calls['request.findOne'][0][0], { _id: requestId, $or: [{ owner: owner._id }, { sitter: owner._id }] });
  assert.doesNotMatch(JSON.stringify(calls.populations), /password|email|medicationHistory/);
});

test('a nonparticipant cannot read or mutate a request', async () => {
  for (const handler of ['getRequest', 'proposeOffer', 'respondToRequest']) {
    const { calls, errors, invoke } = setup({ 'request.findOne': () => null });
    await invoke(handler);
    assert.equal(errors[0].status, 404);
    assert.equal(calls['request.update'], undefined);
  }
});

test('counteroffers atomically replace the rate and record who must receive a response', async () => {
  const { req, calls, stored, invoke } = setup();
  req.user = sitter;
  await invoke('proposeOffer');
  const [filter, update] = calls['request.update'][0];
  assert.equal(filter.status, 'pending');
  assert.equal(filter.__v, 0);
  assert.deepEqual(filter.$or, [{ owner: sitter._id }, { sitter: sitter._id }]);
  assert.equal(update.$set.offerBy, sitter._id);
  assert.equal(update.$set.proposedRate, 23.5);
  assert.equal(update.$push.history.action, 'offer');
  assert.equal(stored.__v, 1);
});

test('a closed or expired job rejects counteroffers and retains the request for withdrawal or messages', async () => {
  const { res, calls, invoke } = setup({ 'job.exists': () => false }, { kind: 'job', job: { ...job, status: 'closed' } });
  await invoke('proposeOffer');
  assert.equal(res.statusCode, 409);
  assert.match(res.locals.errorMessage, /closed or has ended/);
  assert.equal(calls['request.update'], undefined);
  assert.equal(calls['job.exists'][0][0].status, 'open');
  assert.ok(calls['job.exists'][0][0].endDate.$gt instanceof Date);
});

test('a stale response cannot accept a newer hourly offer', async () => {
  const { req, res, calls, invoke } = setup({}, { __v: 1, proposedRate: 40 });
  req.user = sitter;
  await invoke('respondToRequest');
  assert.equal(res.statusCode, 409);
  assert.equal(calls['request.update'], undefined);
  assert.equal(res.locals.careRequest.proposedRate, 40);
  assert.equal(res.locals.careRequest.__v, 1);
});

test('an offer changing between read and update is rejected by the atomic version guard', async () => {
  const { req, res, calls, invoke } = setup({ 'request.update': () => null });
  req.user = sitter;
  await invoke('respondToRequest');
  assert.equal(calls['request.update'][0][0].__v, 0);
  assert.equal(res.statusCode, 409);
  assert.equal(res.location, undefined);
});

test('participants cannot accept or decline their own latest offer', async () => {
  for (const action of ['accept', 'decline']) {
    const { req, calls, errors, invoke } = setup();
    req.body.action = action;
    await invoke('respondToRequest');
    assert.equal(errors[0].status, 403);
    assert.equal(calls['request.update'], undefined);
  }
});

test('only the initiator may withdraw, and withdrawals stop further offers', async () => {
  const blocked = setup();
  blocked.req.user = sitter;
  blocked.req.body.action = 'withdraw';
  await blocked.invoke('respondToRequest');
  assert.equal(blocked.errors[0].status, 403);
  const allowed = setup();
  allowed.req.body.action = 'withdraw';
  await allowed.invoke('respondToRequest');
  assert.equal(allowed.calls['request.update'][0][0].initiatedBy, owner._id);
  assert.equal(allowed.stored.status, 'withdrawn');
  await allowed.invoke('proposeOffer');
  assert.equal(allowed.res.statusCode, 409);
  assert.equal(allowed.calls['request.update'].length, 1);
});

test('accepting a job closes it and records the agreed hourly rate', async () => {
  const { calls, stored, res, invoke } = setup({}, { kind: 'job', job, initiatedBy: sitter._id, offerBy: sitter._id });
  await invoke('respondToRequest');
  assert.equal(stored.status, 'accepted');
  assert.equal(stored.history[0].rate, 20);
  assert.equal(calls['job.updateOne'][0][0]._id, job._id);
  assert.equal(calls['job.updateOne'][0][0].status, 'open');
  assert.deepEqual(calls['job.updateOne'][0][1], { $set: { status: 'closed' } });
  assert.equal(res.location, `/requests/${requestId}`);
});

test('an acceptance racing with manual job closure restores the pending request', async () => {
  const { calls, stored, res, invoke } = setup({ 'job.updateOne': () => ({ matchedCount: 0 }) }, { kind: 'job', job, initiatedBy: sitter._id, offerBy: sitter._id });
  await invoke('respondToRequest');
  assert.equal(stored.status, 'pending');
  assert.equal(stored.__v, 2);
  assert.equal(stored.history.length, 0);
  assert.equal(calls['request.update'][1][0].status, 'accepted');
  assert.equal(calls['request.update'][1][0].__v, 1);
  assert.deepEqual(calls['request.update'][1][0].$or, [{ owner: owner._id }, { sitter: owner._id }]);
  assert.equal(res.statusCode, 409);
});

test('the accepted-job unique index conflict is shown without closing the job twice', async () => {
  const { res, calls, invoke } = setup({ 'request.update': () => { throw Object.assign(new Error('duplicate'), { code: 11000 }); } }, { kind: 'job', job, offerBy: sitter._id });
  await invoke('respondToRequest');
  assert.equal(res.statusCode, 409);
  assert.match(res.locals.errorMessage, /Another sitter/);
  assert.equal(calls['job.updateOne'], undefined);
});

test('malformed IDs and wrong-role creation do not reach database queries', async () => {
  const malformed = setup();
  malformed.req.params.requestId = 'invalid';
  await malformed.invoke('getRequest');
  assert.equal(malformed.errors[0].status, 400);
  assert.equal(malformed.calls['request.findOne'], undefined);
  const wrongRole = setup();
  await wrongRole.invoke('getJobRequestForm');
  assert.equal(wrongRole.errors[0].status, 403);
  assert.equal(wrongRole.calls['job.findOne'], undefined);
});

test('request schema validates money precision, job requirements, and participant identities', async () => {
  const CareRequest = require('../models/CareRequest');
  const values = { owner: owner._id, sitter: sitter._id, pet: pet._id, kind: 'interview', initiatedBy: owner._id, offerBy: owner._id, proposedRate: 25.5 };
  await new CareRequest(values).validate();
  await assert.rejects(new CareRequest({ ...values, proposedRate: 25.555 }).validate(), /decimal places/);
  await assert.rejects(new CareRequest({ ...values, kind: 'job' }).validate(), /job/);
  await assert.rejects(new CareRequest({ ...values, job: job._id }).validate(), /Direct interviews/);
  await assert.rejects(new CareRequest({ ...values, sitter: owner._id }).validate(), /different participant/);
  await assert.rejects(new CareRequest({ ...values, initiatedBy: pet._id }).validate(), /participant/);
  const indexes = CareRequest.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.owner === 1 && keys.sitter === 1 && options.unique && options.partialFilterExpression.status === 'pending'));
  assert.ok(indexes.some(([keys, options]) => keys.job === 1 && options.unique && options.partialFilterExpression.kind === 'job' && options.partialFilterExpression.status === 'accepted'));
});

test('request pages render rates, functional actions, empty states, and escaped messages', async () => {
  const injection = '<script>unsafe()</script>';
  const { stored } = setup({}, { message: injection, history: [{ actor: owner, action: 'created', rate: 20, message: injection, at: new Date() }] });
  const base = { user: sitter, careRequest: stored, otherParticipant: owner, errorMessage: '', values: {} };
  const render = (name, locals) => ejs.renderFile(path.join(__dirname, '../views/requests', name + '.ejs'), locals);
  const detail = await render('detail', base);
  assert.match(detail, /\/hr/);
  assert.match(detail, new RegExp(`action="/requests/${requestId}/respond"`));
  assert.match(detail, /name="expectedVersion" value="0"/);
  assert.match(detail, new RegExp(`/messages/new\\?recipient=${owner._id}`));
  assert.doesNotMatch(detail, /<script>unsafe\(\)<\/script>/);
  assert.match(detail, /&lt;script&gt;/);
  const empty = await render('index', { user: owner, careRequests: [] });
  assert.match(empty, /No requests yet/);
  const create = await render('new', { user: owner, context: { kind: 'interview', action: `/sitters/${sitter._id}/requests`, sitter, pets: [pet] }, values: { proposedRate: 20 }, errorMessage: '' });
  assert.match(create, /name="petId"/);
  assert.match(create, /name="proposedRate"/);
  const closed = await render('detail', { ...base, careRequest: { ...stored, kind: 'job', job: { ...job, status: 'closed' } } });
  assert.match(closed, /closed or has ended/);
  assert.doesNotMatch(closed, /name="action" value="accept"/);
  assert.doesNotMatch(closed, new RegExp(`action="/requests/${requestId}/offers"`));
  assert.match(closed, /name="action" value="decline"/);
});
