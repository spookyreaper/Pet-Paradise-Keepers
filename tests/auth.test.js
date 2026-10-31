const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const session = require('express-session');
const bcrypt = require('bcrypt');
const User = require('../models/accountSchema');
const { createApp } = require('../app');

const ownerId = '507f191e810c19729de860ea';
const registration = {
  username: '  TESTER  ', email: '  TEST@EXAMPLE.COM  ', password: 'secret123',
  firstName: '  Test ', lastName: ' Owner  ', role: 'owner',
};

test('authentication validates input and persists fresh sessions', async t => {
  const store = new session.MemoryStore();
  const originals = { findOne: User.findOne, create: User.create };
  let foundUser = null;
  let query;
  let created;
  let createError;
  let databaseCalls = 0;
  User.findOne = async filter => { databaseCalls++; query = filter; return foundUser; };
  User.create = async values => {
    created = values;
    if (createError) throw createError;
    return { ...values, _id: ownerId };
  };

  const server = createApp({ sessionStore: store, sessionSecret: 'auth-regression-test-secret' }).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (url, values, cookie) => fetch(`${base}${url}`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(values),
    });

    await t.test('guest pages do not create empty sessions and sitter role links work', async () => {
      const response = await fetch(`${base}/register?role=sitter`);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.match(await response.text(), /value="sitter" selected/);
    });

    await t.test('missing and object-shaped login fields get validation errors', async () => {
      for (const values of [{}, { username: { $ne: null }, password: 'secret' }, { username: 'tester', password: [] }]) {
        const before = databaseCalls;
        const response = await post('/login', values);
        assert.equal(response.status, 400);
        assert.match(await response.text(), /Please enter/);
        assert.equal(databaseCalls, before);
      }
    });

    await t.test('invalid registration rejects roles, short passwords, malformed email and missing names', async () => {
      for (const values of [
        {}, { ...registration, role: 'admin' }, { ...registration, password: '12345' },
        { ...registration, email: 'bad@example.com trailing' }, { ...registration, firstName: [] },
        { ...registration, password: 'é'.repeat(37) },
        { ...registration, username: 'someone@example.com' },
      ]) {
        const before = databaseCalls;
        const response = await post('/register', values);
        assert.equal(response.status, 400);
        assert.equal(databaseCalls, before);
      }
    });

    await t.test('registration trims names, normalizes identifiers, hashes password and saves the session', async () => {
      const response = await post('/register', registration);
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), '/completeOwnerInfo');
      assert.equal(created.username, 'tester');
      assert.equal(created.email, 'test@example.com');
      assert.equal(created.firstName, 'Test');
      assert.equal(created.lastName, 'Owner');
      assert.notEqual(created.password, registration.password);
      assert.equal(await bcrypt.compare(registration.password, created.password), true);
      const sessions = await new Promise((resolve, reject) => store.all((error, values) => error ? reject(error) : resolve(values)));
      const saved = Object.values(sessions).find(value => value.userId === ownerId);
      assert.equal(saved.role, 'owner');
      assert.equal(saved.password, undefined);
      assert.ok(response.headers.get('set-cookie'));
    });

    await t.test('duplicate-key races return an actionable conflict and preserve fields', async () => {
      createError = Object.assign(new Error('duplicate'), { code: 11000 });
      const response = await post('/register', registration);
      assert.equal(response.status, 409);
      const html = await response.text();
      assert.match(html, /already exists/);
      assert.match(html, /value="tester"/);
      assert.doesNotMatch(html, /value="secret123"/);
      createError = null;
    });

    await t.test('unknown accounts and incorrect passwords share an error message', async () => {
      const missing = await post('/login', { username: 'tester', password: 'wrong' });
      assert.equal(missing.status, 401);
      const missingHtml = await missing.text();
      foundUser = { _id: ownerId, role: 'owner', password: created.password };
      const wrong = await post('/login', { username: 'tester', password: 'wrong' });
      assert.equal(wrong.status, 401);
      assert.match(missingHtml, /Invalid username or password/);
      assert.match(await wrong.text(), /Invalid username or password/);
    });

    await t.test('login accepts normalized email, replaces the session ID and logout clears it', async () => {
      const first = await post('/login', { username: '  TEST@EXAMPLE.COM ', password: 'secret123' });
      assert.equal(first.status, 302);
      assert.deepEqual(query, { $or: [{ username: 'test@example.com' }, { email: 'test@example.com' }] });
      const oldCookie = first.headers.get('set-cookie').split(';')[0];
      const second = await post('/login', { username: 'tester', password: 'secret123' }, oldCookie);
      assert.equal(second.status, 302);
      const newCookie = second.headers.get('set-cookie').split(';')[0];
      assert.notEqual(newCookie, oldCookie);
      const logout = await post('/logout', {}, newCookie);
      assert.equal(logout.status, 302);
      assert.equal(logout.headers.get('location'), '/login');
      assert.match(logout.headers.get('set-cookie'), /connect.sid=;/);
      const protectedPage = await fetch(`${base}/dashboard`, { redirect: 'manual', headers: { cookie: newCookie } });
      assert.equal(protectedPage.headers.get('location'), '/login');
    });
  } finally {
    Object.assign(User, originals);
    await new Promise(resolve => server.close(resolve));
    store.clear();
  }
});
