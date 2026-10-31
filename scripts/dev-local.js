const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
require('dotenv').config();

const root = path.resolve(__dirname, '..');
const localDirectory = path.join(root, '.local');
const bundledBinary = path.join(localDirectory, 'mongodb/bin/mongod');
const mongod = process.env.MONGOD_BIN || (fs.existsSync(bundledBinary) ? bundledBinary : 'mongod');
const databasePort = 27018;
const databaseUri = `mongodb://127.0.0.1:${databasePort}/pet-paradise-keepers-local`;
const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  }
  mongoose.disconnect().catch(error => console.error(error.message));
  setTimeout(() => process.exit(code), 5000).unref();
}

function launch(command, args, options) {
  const child = spawn(command, args, { cwd: root, ...options });
  children.push(child);
  child.once('error', error => {
    console.error(command === mongod && error.code === 'ENOENT'
      ? 'MongoDB is not installed. Install mongod or set MONGOD_BIN to its executable path.'
      : error.message);
    stop(1);
  });
  child.once('exit', code => {
    if (!stopping) {
      if (command === mongod) console.error('Local MongoDB stopped. Check .local/mongodb.log for details.');
      stop(code || 0);
    }
  });
  return child;
}

async function start() {
  const dataDirectory = path.join(localDirectory, 'mongodb-data');
  fs.mkdirSync(dataDirectory, { recursive: true });
  launch(mongod, [
    '--dbpath', dataDirectory,
    '--bind_ip', '127.0.0.1',
    '--port', String(databasePort),
    '--logpath', path.join(localDirectory, 'mongodb.log'),
    '--logappend',
  ], { stdio: ['ignore', 'ignore', 'inherit'] });

  await mongoose.connect(databaseUri, { serverSelectionTimeoutMS: 10000 });
  await mongoose.disconnect();
  if (stopping) return;
  console.log('Using a separate local test database. Your .env configuration is unchanged.');
  launch(process.execPath, ['server.js'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      MONGODB_URI: databaseUri,
      SESSION_SECRET: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
    },
  });
}

process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
start().catch(error => {
  console.error('Unable to start locally:', error.message);
  stop(1);
});
