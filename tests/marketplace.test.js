const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const { dateInput, parseDateInput } = require('../utils/dates');
const SittingJob = require('../models/SittingJob');

const ownerId = '111111111111111111111111';
const otherId = '333333333333333333333333';
const petId = '222222222222222222222222';
const jobId = '444444444444444444444444';
const user = { _id: ownerId, role: 'owner' };
const pet = { _id: petId, owner: ownerId, name: 'Mochi', type: 'Cat' };
const body = () => ({ petId, title: '  A weekend with Mochi ', description: ' Feed twice daily. ', location: ' Brooklyn ',
  startDate: dateInput(Date.now() + 86400000), endDate: dateInput(Date.now() + 90000000), budget: '25.50' });

function setup(overrides = {}) {
  const calls = {};
  const chain = (name, value) => (...args) => {
    (calls[name] ||= []).push(args);
    const result = overrides[name] ? overrides[name](...args) : value;
    const query = {};
    for (const operation of ['select', 'populate', 'sort', 'skip', 'limit']) query[operation] = (...values) => {
      (calls[`${name}.${operation}`] ||= []).push(values);
      return query;
    };
    query.lean = () => Promise.resolve(result);
    query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
    return query;
  };
  const operation = (name, value) => async (...args) => {
    (calls[name] ||= []).push(args);
    return overrides[name] ? overrides[name](...args) : value;
  };
  const job = { _id: jobId, owner: ownerId, pet: petId, status: 'open', ...body() };
  const accounts = { find: chain('account.find', []), findOne: chain('account.findOne', null), countDocuments: operation('account.count', 0) };
  const pets = { find: chain('pet.find', [pet]), findOne: operation('pet.findOne', pet), exists: operation('pet.exists', pet) };
  const jobs = { find: chain('job.find', []), findOne: chain('job.findOne', job), countDocuments: operation('job.count', 0),
    create: operation('job.create', { _id: jobId }), findOneAndUpdate: operation('job.update', job) };
  const filename = require.resolve('../controllers/marketplaceController');
  const original = Module._load;
  Module._load = function(request, parent, main) {
    if (parent?.filename === filename) {
      if (request === '../models/accountSchema') return accounts;
      if (request === '../models/Pet') return pets;
      if (request === '../models/SittingJob') return jobs;
    }
    return original.call(this, request, parent, main);
  };
  let controller;
  try { delete require.cache[filename]; controller = require(filename); }
  finally { Module._load = original; delete require.cache[filename]; }
  const req = { user: { ...user }, body: body(), params: { jobId, sitterId: otherId }, query: {} };
  const res = { statusCode: 200, status(value) { this.statusCode = value; return this; },
    render(template, values) { this.template = template; this.values = values; }, redirect(value) { this.location = value; } };
  const errors = [];
  return { req, res, calls, errors, invoke: method => controller[method](req, res, error => errors.push(error)) };
}

test('job dates are interpreted in Eastern time and reject invalid wall-clock values', () => {
  assert.equal(parseDateInput('2026-10-12T09:00').toISOString(), '2026-10-12T13:00:00.000Z');
  assert.equal(parseDateInput('2026-12-12T09:00').toISOString(), '2026-12-12T14:00:00.000Z');
  assert.equal(dateInput(parseDateInput('2026-11-01T01:30')), '2026-11-01T01:30');
  for (const value of ['2026-03-08T02:30', '2026-02-30T09:00', '2026-10-12T24:00', '', {}, '2026-10-12']) {
    assert.throws(() => parseDateInput(value), error => error.status === 400);
  }
});

test('the job schema validates hourly amounts and date ranges', async () => {
  const values = { owner: ownerId, pet: petId, title: 'Care', description: 'Care notes', startDate: new Date('2030-01-01T12:00Z'), endDate: new Date('2030-01-02T12:00Z'), budget: 25.5 };
  await new SittingJob(values).validate();
  for (const change of [{ budget: Infinity }, { budget: -1 }, { budget: 1.234 }, { budget: 10001 }, { endDate: values.startDate }]) {
    await assert.rejects(new SittingJob({ ...values, ...change }).validate(), error => error.name === 'ValidationError');
  }
});

test('posting a job validates ownership and uses the logged-in owner', async () => {
  const { req, res, calls, errors, invoke } = setup();
  req.body.owner = otherId;
  await invoke('createJob');
  assert.deepEqual(calls['pet.findOne'][0][0], { _id: petId, owner: ownerId });
  const saved = calls['job.create'][0][0];
  assert.equal(saved.owner, ownerId);
  assert.equal(saved.title, 'A weekend with Mochi');
  assert.equal(saved.budget, 25.5);
  assert.ok(saved.startDate instanceof Date);
  assert.equal(res.location, `/jobs/${jobId}`);
  assert.deepEqual(errors, []);
});

test('other owners pets cannot be advertised and validation preserves form values', async () => {
  const { res, calls, invoke } = setup({ 'pet.findOne': () => null });
  await invoke('createJob');
  assert.equal(res.statusCode, 400);
  assert.match(res.values.errorMessage, /own pets/);
  assert.equal(res.values.values.description, ' Feed twice daily. ');
  assert.equal(calls['job.create'], undefined);
});

test('job fields reject injection, invalid prices and date ranges before persistence', async () => {
  for (const change of [{ petId: { $ne: null } }, { description: [] }, { title: '' }, { budget: '' }, { budget: 'Infinity' }, { budget: '-1' }, { budget: '12.333' }, { startDate: '2000-01-01T12:00' }, { endDate: '2000-01-01T12:00' }]) {
    const { req, res, calls, invoke } = setup();
    Object.assign(req.body, change);
    await invoke('createJob');
    assert.equal(res.statusCode, 400, JSON.stringify(change));
    assert.equal(calls['job.create'], undefined);
  }
});

test('sitters cannot post, edit, close jobs or browse sitter-only owner directory', async () => {
  for (const handler of ['createJob', 'getNewJob', 'updateJob', 'getEditJob', 'closeJob', 'getSitters', 'getSitter']) {
    const { req, errors, calls, invoke } = setup();
    req.user.role = 'sitter';
    await invoke(handler);
    assert.equal(errors[0].status, 403, handler);
    assert.equal(calls['job.create'], undefined);
    assert.equal(calls['job.update'], undefined);
  }
});

test('job detail, edits and closing scope the query to the owner', async () => {
  for (const handler of ['getJob', 'getEditJob', 'updateJob', 'closeJob']) {
    const { calls, invoke } = setup({ 'job.findOne': () => null, 'job.update': () => null });
    await invoke(handler);
    const filter = (calls['job.findOne'] || calls['job.update'])[0][0];
    assert.equal(filter.owner, ownerId, handler);
  }
});

test('editing a job cannot swap pets or reopen a closed listing', async () => {
  const { req, res, calls, invoke } = setup();
  req.body.petId = otherId;
  await invoke('updateJob');
  assert.equal(res.statusCode, 400);
  assert.match(res.values.errorMessage, /same pet/);
  assert.equal(calls['job.update'], undefined);
  const closed = setup({ 'job.findOne': () => ({ _id: jobId, owner: ownerId, status: 'closed' }) });
  await closed.invoke('updateJob');
  assert.equal(closed.errors[0].status, 409);
});

test('sitter job discovery filters to open future jobs and omits private pet fields', async () => {
  const { req, calls, invoke } = setup();
  req.user.role = 'sitter';
  req.query.owner = otherId;
  await invoke('getJobs');
  const filter = calls['job.find'][0][0];
  assert.equal(filter.status, 'open');
  assert.equal(filter.owner, otherId);
  assert.ok(filter.endDate.$gt instanceof Date);
  assert.doesNotMatch(calls['job.find.populate'].map(args => args[1]).join(' '), /email|password|medicationHistory/);
});

test('the owner listing only loads the logged-in owners jobs', async () => {
  const { req, calls, invoke } = setup();
  req.query.owner = otherId;
  await invoke('getJobs');
  assert.deepEqual(calls['job.find'][0][0], { owner: ownerId });
});

test('sitter search escapes regex and selects only public profile data', async () => {
  const { req, calls, res, invoke } = setup();
  req.query = { q: 'A.*', maxRate: '30.50' };
  await invoke('getSitters');
  const filter = calls['account.find'][0][0];
  assert.equal(filter.role, 'sitter');
  assert.equal(filter.rate.$lte, 30.5);
  assert.equal(filter.$or[0].firstName.test('A.*'), true);
  assert.equal(filter.$or[0].firstName.test('Anything'), false);
  assert.doesNotMatch(calls['account.find.select'][0][0], /email|password|username/);
  assert.deepEqual(res.values.filters, { q: 'A.*', maxRate: '30.50' });
});

test('pagination retains search filters and rejects malformed page inputs', async () => {
  const { req, res, calls, invoke } = setup({ 'account.count': () => 30 });
  req.query = { page: '2', q: 'Maya', maxRate: '30' };
  await invoke('getSitters');
  assert.equal(calls['account.find.skip'][0][0], 12);
  assert.equal(res.values.pagination.previous, '/sitters?q=Maya&maxRate=30&page=1');
  assert.equal(res.values.pagination.next, '/sitters?q=Maya&maxRate=30&page=3');
  for (const page of ['-1', 'NaN', [], '1.5', '999999999']) {
    const invalid = setup(); invalid.req.query.page = page;
    await invalid.invoke('getJobs');
    assert.equal(invalid.errors[0].status, 400);
  }
});
