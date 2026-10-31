const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const owner = { _id: '111111111111111111111111', role: 'owner', firstName: 'Alex' };
const pet = {
  _id: '222222222222222222222222', owner: owner._id,
  name: 'Milo', type: 'Dog', medicationHistory: 'Existing medicine', photoUrl: '/uploads/old.png',
};

function setup(overrides = {}) {
  const calls = {};
  const track = (name, fallback) => async (...args) => {
    (calls[name] ||= []).push(args);
    if (overrides[name]) return overrides[name](...args);
    return typeof fallback === 'function' ? fallback(...args) : fallback;
  };
  const petModel = {
    create: track('create', values => ({ _id: pet._id, ...values })),
    findOne: track('findOne', pet),
    find: track('find', [pet]),
    findOneAndUpdate: track('findOneAndUpdate', pet),
    findOneAndDelete: track('findOneAndDelete', pet),
    deleteOne: track('deleteOne', { deletedCount: 1 }),
  };
  const accountModel = {
    findById: track('findById', owner),
    findByIdAndUpdate: track('findByIdAndUpdate', owner),
  };
  const uploadHelpers = {
    uploadedPhoto: file => file ? '/uploads/new.png' : '',
    discardUploads: track('discardUploads', undefined),
    removeStoredPhoto: track('removeStoredPhoto', undefined),
  };

  const controllerPath = require.resolve('../controllers/petController');
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === controllerPath) {
      if (request === '../models/Pet') return petModel;
      if (request === '../models/accountSchema') return accountModel;
      if (request === '../utils/upload') return uploadHelpers;
      if (request === '../utils/marketplaceCleanup') return { removePetMarketplaceData: track('removePetMarketplaceData', undefined) };
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
    user: owner,
    session: { userId: owner._id, role: 'owner' },
    params: { petId: pet._id },
    body: { name: 'Milo', type: 'Dog', medicationHistory: 'Daily medicine' },
  };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    render(view, locals) { this.view = view; this.locals = locals; return this; },
    redirect(location) { this.location = location; return this; },
  };
  const errors = [];
  const invoke = name => controller[name](req, res, error => errors.push(error));
  return { req, res, calls, errors, invoke };
}

test('adding a pet saves a single uploaded photo and the existing medical history field', async () => {
  const { req, res, calls, errors, invoke } = setup();
  req.body = { petName: '  Milo  ', petType: ' Dog ', petMedicalHistory: ' Daily medicine ', owner: 'other-user' };
  req.file = { path: 'public/uploads/new.png' };
  await invoke('processAddPet');
  assert.deepEqual(calls.create[0][0], {
    name: 'Milo', type: 'Dog', medicationHistory: 'Daily medicine', photoUrl: '/uploads/new.png', owner: owner._id,
  });
  assert.deepEqual(calls.findByIdAndUpdate[0], [owner._id, { $addToSet: { pets: pet._id } }]);
  assert.equal(res.location, '/dashboard');
  assert.deepEqual(errors, []);
});

test('invalid new pet fields keep the form input and discard its upload', async () => {
  const { req, res, calls, invoke } = setup();
  req.body = { name: '   ', type: 'Dog', medicationHistory: 'Keep this note' };
  req.file = { path: 'public/uploads/new.png' };
  await invoke('processAddPet');
  assert.equal(res.statusCode, 400);
  assert.equal(res.view, 'addPet');
  assert.equal(res.locals.pet.medicationHistory, 'Keep this note');
  assert.match(res.locals.errorMessage, /name and type/);
  assert.equal(calls.create, undefined);
  assert.equal(calls.discardUploads.length, 1);
});

test('an account linking failure removes the newly created pet and its upload', async () => {
  const failure = new Error('Database unavailable');
  const { req, calls, errors, invoke } = setup({ findByIdAndUpdate: () => { throw failure; } });
  req.file = { path: 'public/uploads/new.png' };
  await invoke('processAddPet');
  assert.deepEqual(calls.deleteOne[0][0], { _id: pet._id, owner: owner._id });
  assert.equal(calls.discardUploads.length, 1);
  assert.equal(errors[0], failure);
});

test('a failed rollback keeps the photo still referenced by the surviving pet', async context => {
  const failure = new Error('Account linking failed');
  const cleanupFailure = new Error('Pet deletion failed');
  context.mock.method(console, 'error', () => {});
  const { req, calls, errors, invoke } = setup({
    findByIdAndUpdate: () => { throw failure; },
    deleteOne: () => { throw cleanupFailure; },
  });
  req.file = { path: 'public/uploads/new.png' };
  await invoke('processAddPet');
  assert.equal(calls.deleteOne.length, 1);
  assert.equal(calls.discardUploads, undefined);
  assert.equal(req.file, undefined);
  assert.equal(req.files, undefined);
  assert.equal(errors[0], failure);
});

for (const handler of ['getEditPet', 'showPetDetails', 'updatePetInfo', 'deletePet']) {
  test(`${handler} rejects malformed pet IDs before calling the pet database`, async () => {
    const { req, calls, errors, invoke } = setup();
    req.params.petId = 'not-an-object-id';
    await invoke(handler);
    assert.equal(errors[0].status, 400);
    assert.equal(calls.findOne, undefined);
    assert.equal(calls.findOneAndUpdate, undefined);
    assert.equal(calls.findOneAndDelete, undefined);
  });

  test(`${handler} hides pets belonging to another owner`, async () => {
    const { calls, errors, invoke } = setup({ findOne: () => null, findOneAndDelete: () => null });
    await invoke(handler);
    const lookup = handler === 'deletePet' ? calls.findOneAndDelete : calls.findOne;
    assert.deepEqual(lookup[0][0], { _id: pet._id, owner: owner._id });
    assert.equal(errors[0].status, 404);
    assert.equal(calls.findOneAndUpdate, undefined);
    assert.equal(calls.findByIdAndUpdate, undefined);
    assert.equal(calls.removeStoredPhoto, undefined);
  });
}

test('editing medical history keeps the existing photo when no replacement was uploaded', async () => {
  const { req, res, calls, errors, invoke } = setup();
  req.body = { name: 'Milo', type: 'Dog', medicalHistory: 'Updated medicine', owner: 'other-user', photoUrl: '/fake.png' };
  await invoke('updatePetInfo');
  assert.deepEqual(calls.findOneAndUpdate[0], [
    { _id: pet._id, owner: owner._id },
    { $set: { name: 'Milo', type: 'Dog', medicationHistory: 'Updated medicine' } },
    { new: true, runValidators: true },
  ]);
  assert.equal(res.location, '/dashboard');
  assert.equal(calls.removeStoredPhoto, undefined);
  assert.deepEqual(errors, []);
});

test('replacing a pet photo removes the old photo only after the pet update succeeds', async () => {
  const events = [];
  const { req, res, calls, invoke } = setup({
    findOneAndUpdate: () => { events.push('updated'); return pet; },
    removeStoredPhoto: () => { events.push('removed'); },
  });
  req.file = { path: 'public/uploads/new.png' };
  await invoke('updatePetInfo');
  assert.equal(calls.findOneAndUpdate[0][1].$set.photoUrl, '/uploads/new.png');
  assert.deepEqual(calls.removeStoredPhoto[0], ['/uploads/old.png']);
  assert.deepEqual(events, ['updated', 'removed']);
  assert.equal(res.location, '/dashboard');
});

test('a replacement at the same stored photo path is retained', async () => {
  const { req, calls, invoke } = setup({ findOne: () => ({ ...pet, photoUrl: '/uploads/new.png' }) });
  req.file = { path: 'public/uploads/new.png' };
  await invoke('updatePetInfo');
  assert.equal(calls.findOneAndUpdate[0][1].$set.photoUrl, '/uploads/new.png');
  assert.equal(calls.removeStoredPhoto, undefined);
});

test('a failed pet update keeps the old photo and discards only the new upload', async () => {
  const failure = new Error('Pet update failed');
  const { req, calls, errors, invoke } = setup({ findOneAndUpdate: () => { throw failure; } });
  req.file = { path: 'public/uploads/new.png' };
  await invoke('updatePetInfo');
  assert.equal(calls.removeStoredPhoto, undefined);
  assert.equal(calls.discardUploads.length, 1);
  assert.equal(errors[0], failure);
});

test('editing a pet with invalid history keeps the existing photo and explains the error', async () => {
  const { req, res, calls, invoke } = setup();
  req.body.medicationHistory = { unexpected: 'object' };
  req.file = { path: 'public/uploads/new.png' };
  await invoke('updatePetInfo');
  assert.equal(res.statusCode, 400);
  assert.equal(res.view, 'editPet');
  assert.equal(res.locals.pet.photoUrl, pet.photoUrl);
  assert.match(res.locals.errorMessage, /Medical history/);
  assert.equal(calls.findOneAndUpdate, undefined);
  assert.equal(calls.discardUploads.length, 1);
});

test('the pets page queries pets by owner and supplies the template list and current user', async () => {
  const { res, calls, invoke } = setup();
  await invoke('viewPets');
  assert.deepEqual(calls.find[0][0], { owner: owner._id });
  assert.equal(res.view, 'viewPets');
  assert.deepEqual(res.locals.pets, [pet]);
  assert.equal(res.locals.user, owner);
});

test('deletion scopes the mutation to the owner and removes the account reference', async () => {
  const { res, calls, invoke } = setup();
  await invoke('deletePet');
  assert.deepEqual(calls.findOneAndDelete[0][0], { _id: pet._id, owner: owner._id });
  assert.deepEqual(calls.removeStoredPhoto[0], [pet.photoUrl]);
  assert.deepEqual(calls.findByIdAndUpdate[0], [owner._id, { $pull: { pets: pet._id } }]);
  assert.equal(res.location, '/dashboard');
});

test('a deleted pet photo is removed even when unlinking the account reference fails', async () => {
  const failure = new Error('Account update failed');
  const { calls, errors, invoke } = setup({ findByIdAndUpdate: () => { throw failure; } });
  await invoke('deletePet');
  assert.deepEqual(calls.removeStoredPhoto[0], [pet.photoUrl]);
  assert.equal(errors[0], failure);
});

test('unauthenticated pet mutations redirect without changing data and discard uploads', async () => {
  const { req, res, calls, invoke } = setup();
  req.session = {};
  req.file = { path: 'public/uploads/new.png' };
  await invoke('processAddPet');
  assert.equal(res.location, '/login');
  assert.equal(calls.create, undefined);
  assert.equal(calls.discardUploads.length, 1);
});
