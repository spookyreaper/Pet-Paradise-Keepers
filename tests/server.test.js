const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const test = require('node:test');

test('startup waits for both MongoDB and the HTTP listener', async t => {
  const filename = require.resolve('../server');
  const originalLoad = Module._load;
  const environmentKeys = ['MONGODB_URI', 'SESSION_SECRET', 'ENABLE_LIVERELOAD', 'PORT'];
  const savedEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
  let connect;
  let listener;
  let listenCalls = 0;
  const mongoose = { connect: (...args) => connect(...args) };
  process.env.MONGODB_URI = 'mongodb://unused.test/pets';
  process.env.SESSION_SECRET = 'startup-test-secret';
  process.env.ENABLE_LIVERELOAD = 'false';
  process.env.PORT = '3000';

  Module._load = function(request, parent, isMain) {
    if (parent?.filename === filename) {
      if (request === 'dotenv') return { config() {} };
      if (request === 'mongoose') return mongoose;
      if (request === './app') return {
        createApp: () => ({ listen: () => { listenCalls++; return listener; } }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  let startServer;
  try {
    delete require.cache[filename];
    ({ startServer } = require('../server'));
  } finally {
    Module._load = originalLoad;
  }

  try {
    await t.test('no HTTP server starts before the database resolves, and readiness waits for listening', async () => {
      let connected;
      connect = () => new Promise(resolve => { connected = resolve; });
      listener = new EventEmitter();
      let ready = false;
      const startup = startServer().then(server => { ready = true; return server; });
      assert.equal(listenCalls, 0);
      connected();
      await new Promise(setImmediate);
      assert.equal(listenCalls, 1);
      assert.equal(ready, false);
      listener.emit('listening');
      assert.equal(await startup, listener);
    });

    await t.test('port-binding errors reject startup instead of emitting an unhandled error', async () => {
      connect = async () => {};
      listener = new EventEmitter();
      const startup = startServer();
      const rejected = assert.rejects(startup, { code: 'EADDRINUSE' });
      await new Promise(setImmediate);
      listener.emit('error', Object.assign(new Error('Address already in use'), { code: 'EADDRINUSE' }));
      await rejected;
    });

    await t.test('configuration and database failures never start an HTTP listener', async () => {
      const before = listenCalls;
      connect = async () => { throw new Error('Database unavailable'); };
      await assert.rejects(startServer(), /Database unavailable/);
      delete process.env.MONGODB_URI;
      await assert.rejects(startServer(), /Set MONGODB_URI/);
      assert.equal(listenCalls, before);
    });
  } finally {
    delete require.cache[filename];
    for (const key of environmentKeys) {
      if (savedEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnvironment[key];
    }
  }
});
