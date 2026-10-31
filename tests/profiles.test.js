const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const bcrypt = require('bcrypt');
const { profileUpdates, sitterInfo } = require('../utils/profile');

const accountId = '111111111111111111111111';
const petId = '222222222222222222222222';
const profileBody = { firstName: '  Alex ', lastName: ' Keeper ', email: ' ALEX@EXAMPLE.COM ' };

function setup(name = 'owner', overrides = {}) {
  const calls = {};
  const order = [];
  const track = (key, fallback) => async (...args) => {
    (calls[key] ||= []).push(args);
    order.push(key);
    if (overrides[key]) return overrides[key](...args);
    return typeof fallback === 'function' ? fallback(...args) : fallback;
  };
  const user = {
    _id: accountId,
    role: name === 'sitter' ? 'sitter' : 'owner',
    firstName: 'Original', lastName: 'Keeper', email: 'original@example.com',
    password: bcrypt.hashSync('current-password', 4),
    profilePhoto: '/uploads/existing.png',
    biography: 'Original biography', experience: 'Original experience', rate: 20,
    pets: [],
    save: track('save', () => user),
    validate: track('validate', undefined),
  };
  const accountModel = {
    exists: track('exists', null),
    findById: id => {
      (calls.findById ||= []).push([id]);
      const promise = Promise.resolve().then(() => overrides.findById ? overrides.findById(id) : user);
      promise.populate = field => {
        (calls.populate ||= []).push([field]);
        return promise;
      };
      return promise;
    },
    findByIdAndDelete: track('findByIdAndDelete', () => user),
  };
  const petModel = {
    create: track('create', values => ({ _id: petId, ...values })),
    deleteOne: track('deleteOne', { deletedCount: 1 }),
    deleteMany: track('deleteMany', { deletedCount: 1 }),
  };
  const uploadHelpers = {
    uploadedPhoto: file => file ? `/uploads/${file.path.split('/').pop()}` : '',
    discardUploads: track('discardUploads', undefined),
    removeStoredPhoto: track('removeStoredPhoto', undefined),
    removeAccountUploads: track('removeAccountUploads', undefined),
  };
  const authHelpers = { postRegister: track('postRegister', undefined) };
  const controllerPath = require.resolve(`../controllers/${name}Controller`);
  const profilePath = require.resolve('../utils/profile');
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (parent && parent.filename === controllerPath) {
      if (request === '../models/accountSchema') return accountModel;
      if (request === '../models/Pet') return petModel;
      if (request === '../utils/upload') return uploadHelpers;
      if (request === '../utils/marketplaceCleanup') return { removeAccountMarketplaceData: track('removeAccountMarketplaceData', undefined) };
      if (request === './authController') return authHelpers;
    }
    if (parent && parent.filename === profilePath) {
      if (request === './upload') return uploadHelpers;
      if (request === '../models/accountSchema') return accountModel;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  let controller;
  try {
    delete require.cache[controllerPath];
    delete require.cache[profilePath];
    controller = require(controllerPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[controllerPath];
    delete require.cache[profilePath];
  }
  const req = {
    user,
    session: {
      userId: accountId, role: user.role,
      destroy(callback) {
        (calls.destroySession ||= []).push([]);
        order.push('destroySession');
        callback(overrides.destroySession ? overrides.destroySession() : null);
      },
    },
    body: { ...profileBody },
  };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    render(view, locals) { this.view = view; this.locals = locals; return this; },
    redirect(location) { this.location = location; return this; },
    clearCookie(name) { this.clearedCookie = name; },
  };
  const errors = [];
  const invoke = handler => controller[handler](req, res, error => errors.push(error));
  return { req, res, user, calls, order, errors, invoke };
}

test('profile input is trimmed, email is normalized, and no password changes without password input', async () => {
  const updates = await profileUpdates({}, profileBody);
  assert.deepEqual(updates, { firstName: 'Alex', lastName: 'Keeper', email: 'alex@example.com' });
});

test('a partial password change is rejected rather than silently ignored', async () => {
  await assert.rejects(profileUpdates({}, { ...profileBody, newPassword: 'new-password' }), /current password.*confirmation/);
});

test('a password change requires the current password and saves a bcrypt hash', async () => {
  const user = { password: await bcrypt.hash('current-password', 4) };
  const body = { ...profileBody, currentPassword: 'current-password', newPassword: 'new-password', confirmNewPassword: 'new-password' };
  const updates = await profileUpdates(user, body);
  assert.notEqual(updates.password, 'new-password');
  assert.equal(await bcrypt.compare('new-password', updates.password), true);
  await assert.rejects(profileUpdates(user, { ...body, currentPassword: 'wrong-password' }), /Current password is incorrect/);
  await assert.rejects(profileUpdates(user, { ...body, confirmNewPassword: 'different-password' }), /do not match/);
});

test('profile password validation prevents short and bcrypt-truncated passwords', async () => {
  for (const password of ['short', '🦴'.repeat(19)]) {
    await assert.rejects(profileUpdates({}, {
      ...profileBody, currentPassword: 'current-password', newPassword: password, confirmNewPassword: password,
    }), /at least 6 characters.*72 bytes/);
  }
});

test('sitter rates accept zero and decimal rates and reject invalid values', () => {
  assert.equal(sitterInfo({ rate: '0' }).rate, 0);
  assert.equal(sitterInfo({ rate: '25.50' }).rate, 25.5);
  for (const rate of ['', '   ', '-1', 'Infinity', 'hello', [], {}, true]) {
    assert.throws(() => sitterInfo({ rate }), /hourly rate/);
  }
});

test('owner profile edit uses the existing profile template', async () => {
  const { res, errors, invoke } = setup();
  await invoke('getEditProfile');
  assert.equal(res.view, 'owner/profile');
  assert.deepEqual(errors, []);
});

test('owner profile saves validated details and uploaded avatar to the schema photo field', async () => {
  const { req, res, user, calls, invoke } = setup();
  req.file = { path: 'public/uploads/new-owner.png' };
  req.body.role = 'sitter';
  await invoke('updateProfile');
  assert.equal(user.firstName, 'Alex');
  assert.equal(user.email, 'alex@example.com');
  assert.equal(user.role, 'owner');
  assert.equal(user.profilePhoto, '/uploads/new-owner.png');
  assert.equal(calls.save.length, 1);
  assert.deepEqual(calls.removeStoredPhoto[0], ['/uploads/existing.png']);
  assert.equal(res.location, '/dashboard');
});

test('duplicate profile email retains the saved photo and discards the failed new upload', async () => {
  const { req, res, calls, invoke } = setup('owner', {
    save: () => { throw Object.assign(new Error('Duplicate email'), { code: 11000 }); },
  });
  req.file = { path: 'public/uploads/failed.png' };
  await invoke('updateProfile');
  assert.equal(res.statusCode, 409);
  assert.equal(res.view, 'owner/profile');
  assert.equal(res.locals.user.profilePhoto, '/uploads/existing.png');
  assert.match(res.locals.errorMessage, /email address is already in use/);
  assert.equal(calls.discardUploads.length, 1);
  assert.equal(calls.removeStoredPhoto, undefined);
});

for (const [name, handler] of [['owner', 'updateProfile'], ['sitter', 'updateSitterProfile']]) {
  test(`${name} profile rejects an email matching another account's username before saving`, async () => {
    const { req, res, user, calls, errors, invoke } = setup(name, {
      exists: () => ({ _id: '333333333333333333333333' }),
    });
    req.body = { ...profileBody, email: ' SITTER@EXAMPLE.COM ', biography: 'About me', experience: 'Experience', rate: '25' };
    req.file = { path: 'public/uploads/failed.png' };
    await invoke(handler);
    assert.deepEqual(calls.exists[0][0], { _id: { $ne: accountId }, username: 'sitter@example.com' });
    assert.equal(res.statusCode, 409);
    assert.equal(res.view, `${name}/profile`);
    assert.match(res.locals.errorMessage, /another account's username.*different email/);
    assert.equal(user.email, 'original@example.com');
    assert.equal(user.profilePhoto, '/uploads/existing.png');
    assert.equal(calls.save, undefined);
    assert.equal(calls.discardUploads.length, 1);
    assert.deepEqual(errors, []);
  });

  test(`${name} profile preserves an unchanged historical email without a cross-field lookup`, async () => {
    const { req, res, user, calls, errors, invoke } = setup(name, {
      exists: () => { throw new Error('Unchanged emails must not be rechecked'); },
    });
    req.body = { ...profileBody, email: ' ORIGINAL@EXAMPLE.COM ', biography: 'About me', experience: 'Experience', rate: '25' };
    await invoke(handler);
    assert.equal(calls.exists, undefined);
    assert.equal(calls.save.length, 1);
    assert.equal(user.email, 'original@example.com');
    assert.equal(res.location, '/dashboard');
    assert.deepEqual(errors, []);
  });
}

for (const [name, handler, wrongRole] of [
  ['owner', 'updateProfile', 'sitter'],
  ['owner', 'deleteAccount', 'sitter'],
  ['sitter', 'updateSitterProfile', 'owner'],
  ['sitter', 'postCompleteSitterInfo', 'owner'],
  ['sitter', 'deleteAccount', 'owner'],
]) {
  test(`${name} ${handler} refuses an account with the wrong role before changing data`, async () => {
    const { user, calls, errors, invoke } = setup(name);
    user.role = wrongRole;
    await invoke(handler);
    assert.equal(errors[0].status, 403);
    assert.equal(calls.save, undefined);
    assert.equal(calls.findByIdAndDelete, undefined);
    assert.equal(calls.deleteMany, undefined);
  });
}

test('owner completion can skip pet creation while preserving the existing avatar', async () => {
  const { req, res, user, calls, invoke } = setup();
  req.body = {};
  await invoke('submitOwnerInfo');
  assert.equal(calls.create, undefined);
  assert.equal(user.profilePhoto, '/uploads/existing.png');
  assert.equal(res.location, '/dashboard');
});

test('owner completion stores medical history and photo fields consistently', async () => {
  const { req, res, user, calls, invoke } = setup();
  req.body = { petName: ' Milo ', petType: ' Dog ', petMedicalHistory: ' Medicine ' };
  req.files = { petPhoto: [{ path: 'public/uploads/pet.png' }], ownerPhoto: [{ path: 'public/uploads/owner.png' }] };
  await invoke('submitOwnerInfo');
  assert.deepEqual(calls.create[0][0], {
    name: 'Milo', type: 'Dog', medicationHistory: 'Medicine', photoUrl: '/uploads/pet.png', owner: accountId,
  });
  assert.deepEqual(user.pets, [petId]);
  assert.equal(user.profilePhoto, '/uploads/owner.png');
  assert.equal(res.location, '/dashboard');
});

test('owner completion retains invalid pet form input and skips database writes', async () => {
  const { req, res, calls, invoke } = setup();
  req.body = { petName: 'Milo', petType: '', petMedicalHistory: 'Keep this medicine' };
  await invoke('submitOwnerInfo');
  assert.equal(res.statusCode, 400);
  assert.equal(res.locals.values.petName, 'Milo');
  assert.equal(res.locals.values.petMedicalHistory, 'Keep this medicine');
  assert.equal(calls.create, undefined);
  assert.equal(calls.save, undefined);
});

test('owner completion rolls back a pet when linking it to the account fails', async () => {
  const failure = new Error('Account save failed');
  const { req, calls, errors, invoke } = setup('owner', { save: () => { throw failure; } });
  req.body = { petName: 'Milo', petType: 'Dog' };
  req.files = { petPhoto: [{ path: 'public/uploads/pet.png' }] };
  await invoke('submitOwnerInfo');
  assert.deepEqual(calls.deleteOne[0][0], { _id: petId, owner: accountId });
  assert.equal(calls.discardUploads.length, 1);
  assert.equal(errors[0], failure);
});

test('owner completion preserves persisted pet photos if rollback also fails', async () => {
  const cleanupFailure = new Error('Pet rollback failed');
  const { req, calls, errors, invoke } = setup('owner', {
    save: () => { throw new Error('Account save failed'); },
    deleteOne: () => { throw cleanupFailure; },
  });
  req.body = { petName: 'Milo', petType: 'Dog' };
  req.files = { petPhoto: [{ path: 'public/uploads/pet.png' }] };
  await invoke('submitOwnerInfo');
  assert.equal(calls.discardUploads, undefined);
  assert.equal(req.files, undefined);
  assert.equal(errors[0], cleanupFailure);
});

test('sitter completion reads the account and preserves the photo when none is uploaded', async () => {
  const { req, res, user, calls, invoke } = setup('sitter');
  await invoke('getCompleteSitterInfo');
  assert.equal(res.locals.user, user);
  req.body = { biography: ' About me ', experience: ' Years of care ', rate: '35.50' };
  await invoke('postCompleteSitterInfo');
  assert.equal(user.biography, 'About me');
  assert.equal(user.experience, 'Years of care');
  assert.equal(user.rate, 35.5);
  assert.equal(user.profilePhoto, '/uploads/existing.png');
  assert.equal(calls.save.length, 1);
  assert.equal(res.location, '/dashboard');
});

test('sitter registration delegates to the shared registration handler with the sitter role', async () => {
  const { req, res, calls, invoke } = setup('sitter');
  await invoke('getSitterRegister');
  assert.equal(res.location, '/register?role=sitter');
  req.body.role = 'owner';
  await invoke('postSitterRegister');
  assert.equal(req.body.role, 'sitter');
  assert.equal(calls.postRegister.length, 1);
});

for (const name of ['owner', 'sitter']) {
  test(`${name} deletion removes the account before pets and logs out`, async () => {
    const { res, calls, order, invoke } = setup(name);
    await invoke('deleteAccount');
    assert.deepEqual(calls.findByIdAndDelete[0], [accountId]);
    assert.deepEqual(calls.deleteMany[0][0], { owner: accountId });
    assert.deepEqual(order, ['findByIdAndDelete', 'deleteMany', 'removeAccountMarketplaceData', 'removeAccountUploads', 'destroySession']);
    assert.equal(calls.removeAccountUploads[0][0].role, name);
    assert.equal(res.clearedCookie, 'connect.sid');
    assert.equal(res.location, '/login');
  });

  test(`${name} failed account deletion keeps pets and the session intact`, async () => {
    const failure = new Error('Account deletion failed');
    const { calls, errors, invoke } = setup(name, { findByIdAndDelete: () => { throw failure; } });
    await invoke('deleteAccount');
    assert.equal(calls.deleteMany, undefined);
    assert.equal(calls.destroySession, undefined);
    assert.equal(errors[0], failure);
  });

  test(`${name} deletion destroys the session even if pet cleanup fails`, async () => {
    const failure = new Error('Pet cleanup failed');
    const { res, calls, errors, invoke } = setup(name, { deleteMany: () => { throw failure; } });
    await invoke('deleteAccount');
    assert.equal(calls.destroySession.length, 1);
    assert.equal(calls.removeAccountUploads, undefined);
    assert.equal(res.clearedCookie, 'connect.sid');
    assert.equal(errors[0], failure);
  });

  test(`${name} deletion handles an account already deleted by another request`, async () => {
    const { res, calls, errors, invoke } = setup(name, { findByIdAndDelete: () => null });
    await invoke('deleteAccount');
    assert.equal(calls.deleteMany, undefined);
    assert.equal(calls.destroySession.length, 1);
    assert.equal(res.location, '/login');
    assert.deepEqual(errors, []);
  });
}

test('dashboard selects the real account role template and populates pets', async () => {
  const { req, res, user, calls, invoke } = setup('dashboard');
  req.session.role = 'sitter';
  await invoke('getDashboard');
  assert.equal(res.view, 'owner/dashboard');
  assert.deepEqual(calls.populate[0], ['pets']);
  user.role = 'sitter';
  await invoke('getDashboard');
  assert.equal(res.view, 'sitter/dashboard');
});

test('dashboard forwards query failures to the shared error handler', async () => {
  const failure = new Error('Database unavailable');
  const { errors, invoke } = setup('dashboard', { findById: () => { throw failure; } });
  await invoke('getDashboard');
  assert.equal(errors[0], failure);
});
