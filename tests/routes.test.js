const assert = require('node:assert/strict');
const { createHmac, randomBytes, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const session = require('express-session');
const User = require('../models/accountSchema');
const Pet = require('../models/Pet');

const sessionSecret = 'local-route-test-secret';
const ownerId = '507f191e810c19729de860ea';
const sitterId = '507f191e810c19729de860eb';
const missingId = '507f191e810c19729de860ec';

function account(id, role) {
  return {
    _id: id,
    role,
    username: `${role}-test`,
    firstName: 'Test',
    lastName: role,
    email: `${role}@example.com`,
    pets: [],
    biography: '',
    experience: '',
    rate: 0,
    profilePhoto: '',
  };
}

function queryResult(value) {
  const promise = Promise.resolve(value);
  promise.exec = () => promise;
  promise.populate = () => promise;
  return promise;
}

async function authenticatedCookie(store, userId, role) {
  const id = randomUUID();
  await new Promise((resolve, reject) => {
    store.set(id, {
      cookie: { originalMaxAge: null, expires: null, secure: false, httpOnly: true, path: '/' },
      userId,
      role,
    }, error => error ? reject(error) : resolve());
  });
  const signature = createHmac('sha256', sessionSecret).update(id).digest('base64').replace(/=+$/, '');
  return `connect.sid=${encodeURIComponent(`s:${id}.${signature}`)}`;
}

test('HTTP routes enforce authentication and account roles without a database', async t => {
  const { createApp } = require('../app');
  const store = new session.MemoryStore();
  const uploadId = randomBytes(12).toString('hex');
  const uploadDirectory = path.join(__dirname, '..', 'public', 'uploads', 'owners', uploadId);
  const uploadOwner = {
    ...account(uploadId, 'owner'),
    validate: async () => {},
    save: async () => {},
  };
  const accounts = new Map([
    [ownerId, account(ownerId, 'owner')],
    [sitterId, account(sitterId, 'sitter')],
    [uploadId, uploadOwner],
  ]);
  const originalFindById = User.findById;
  User.findById = id => queryResult(accounts.get(String(id)) || null);
  const app = createApp({ sessionStore: store, sessionSecret });
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const ownerCookie = await authenticatedCookie(store, ownerId, 'owner');
    const sitterCookie = await authenticatedCookie(store, sitterId, 'sitter');
    const uploadCookie = await authenticatedCookie(store, uploadId, 'owner');
    const request = (url, cookie, options = {}) => fetch(`${base}${url}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(3000),
      ...options,
      headers: { ...options.headers, ...(cookie ? { cookie } : {}) },
    });

    await t.test('guest pages return a usable response', async () => {
      for (const url of ['/', '/login', '/register']) {
        const response = await request(url);
        assert.equal(response.status, 200, url);
        assert.match(await response.text(), /<!DOCTYPE html>/i, url);
      }
    });

    await t.test('protected pages redirect unsigned users to login', async () => {
      for (const url of ['/dashboard', '/owner/profile', '/sitter/profile', '/pets/add', '/pets']) {
        const response = await request(url);
        assert.equal(response.status, 302, url);
        assert.equal(response.headers.get('location'), '/login', url);
      }
    });

    await t.test('owners and sitters can view their own profiles', async () => {
      for (const [url, cookie] of [['/owner/profile', ownerCookie], ['/sitter/profile', sitterCookie]]) {
        const response = await request(url, cookie);
        assert.equal(response.status, 200, url);
        assert.match(await response.text(), /Test/);
      }
    });

    await t.test('owners cannot access sitter-specific routes', async () => {
      for (const [url, method] of [
        ['/sitter/profile', 'GET'],
        ['/sitter/profile', 'POST'],
        ['/sitter/profile/delete', 'DELETE'],
        ['/sitter/complete-info', 'GET'],
        ['/sitter/complete-info', 'POST'],
      ]) {
        const response = await request(url, ownerCookie, { method });
        assert.equal(response.status, 403, `${method} ${url}`);
      }
    });

    await t.test('sitters cannot access owner-specific routes', async () => {
      for (const [url, method] of [
        ['/owner/profile', 'GET'],
        ['/owner/profile', 'POST'],
        ['/owner/profile/delete', 'DELETE'],
        ['/completeOwnerInfo', 'GET'],
        ['/submitOwnerInfo', 'POST'],
        ['/pets/add', 'GET'],
        ['/pets/add', 'POST'],
        ['/pets', 'GET'],
      ]) {
        const response = await request(url, sitterCookie, { method });
        assert.equal(response.status, 403, `${method} ${url}`);
      }
    });

    await t.test('form method override still applies role checks before deletion', async () => {
      const response = await request('/owner/profile/delete?_method=DELETE', sitterCookie, { method: 'POST' });
      assert.equal(response.status, 403);
    });

    await t.test('guards use the stored account role instead of a stale session role', async () => {
      const staleCookie = await authenticatedCookie(store, sitterId, 'owner');
      const response = await request('/pets/add', staleCookie);
      assert.equal(response.status, 403);
    });

    await t.test('a deleted account cannot continue using its old session', async () => {
      const missingCookie = await authenticatedCookie(store, missingId, 'owner');
      const response = await request('/owner/profile', missingCookie);
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), '/login');
    });

    const photoBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
    const photoForm = (mimeType = 'image/png', bytes = photoBytes) => {
      const form = new FormData();
      form.set('ownerPhoto', new Blob([bytes], { type: mimeType }), 'photo.png');
      return form;
    };
    const filesInUploadDirectory = async () => {
      try {
        return await fs.readdir(uploadDirectory);
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    };

    await t.test('multipart uploads require an authenticated owner before file handling', async () => {
      for (const [cookie, expectedStatus] of [[null, 302], [sitterCookie, 403]]) {
        const response = await request('/submitOwnerInfo', cookie, { method: 'POST', body: photoForm('text/html') });
        assert.equal(response.status, expectedStatus);
      }
      assert.deepEqual(await filesInUploadDirectory(), []);
    });

    await t.test('unsupported image formats return 400 without saving a file', async () => {
      for (const mimeType of ['text/html', 'image/svg+xml']) {
        const response = await request('/submitOwnerInfo', uploadCookie, { method: 'POST', body: photoForm(mimeType) });
        assert.equal(response.status, 400, mimeType);
        assert.match(await response.text(), /JPEG, PNG, GIF, or WebP/);
      }
      assert.deepEqual(await filesInUploadDirectory(), []);
    });

    await t.test('photos over 5 MB return 413 and remove the partial upload', async () => {
      const response = await request('/submitOwnerInfo', uploadCookie, {
        method: 'POST',
        body: photoForm('image/png', new Uint8Array(5 * 1024 * 1024 + 1)),
      });
      assert.equal(response.status, 413);
      assert.match(await response.text(), /5 MB or smaller/);
      assert.deepEqual(await filesInUploadDirectory(), []);
    });

    await t.test('paired pet and owner photos receive distinct safe filenames', async () => {
      const originalCreate = Pet.create;
      let createdPet;
      Pet.create = async values => {
        createdPet = { ...values, _id: '507f1f77bcf86cd799439011' };
        return createdPet;
      };
      try {
        const form = new FormData();
        form.set('petName', 'Mochi');
        form.set('petType', 'Cat');
        form.set('petPhoto', new Blob([photoBytes], { type: 'image/png' }), 'same-name.html');
        form.set('ownerPhoto', new Blob([photoBytes], { type: 'image/png' }), 'same-name.html');
        const response = await request('/submitOwnerInfo', uploadCookie, { method: 'POST', body: form });
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), '/dashboard');
        const filenames = await filesInUploadDirectory();
        assert.equal(filenames.length, 2);
        assert.equal(new Set(filenames).size, 2);
        for (const filename of filenames) {
          assert.match(filename, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.png$/);
          assert.equal((await fs.readFile(path.join(uploadDirectory, filename))).equals(photoBytes), true);
        }
        assert.notEqual(createdPet.photoUrl, uploadOwner.profilePhoto);
        assert.match(createdPet.photoUrl, /^\/uploads\/owners\//);
        assert.match(uploadOwner.profilePhoto, /^\/uploads\/owners\//);
      } finally {
        Pet.create = originalCreate;
      }
    });
  } finally {
    User.findById = originalFindById;
    await new Promise(resolve => server.close(resolve));
    store.clear();
    await fs.rm(uploadDirectory, { recursive: true, force: true });
  }
});
