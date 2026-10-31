require('dotenv').config();
const mongoose = require('mongoose');
const path = require('node:path');
const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;

async function startServer() {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI before starting the server.');
  if (!process.env.SESSION_SECRET) throw new Error('Set SESSION_SECRET before starting the server.');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const app = createApp();
  // Requests rely on unique indexes to prevent duplicate applications and double acceptance.
  await Promise.all(Object.values(mongoose.models || {}).map(model => model.init()));

  if (process.env.ENABLE_LIVERELOAD === 'true' && process.env.NODE_ENV !== 'production') {
    const liveReloadServer = require('livereload').createServer();
    liveReloadServer.watch([path.join(__dirname, 'public'), path.join(__dirname, 'views')]);
    liveReloadServer.server.once('connection', () => {
      setTimeout(() => liveReloadServer.refresh('/'), 100);
    });
  }

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(PORT);
    listener.once('error', reject);
    listener.once('listening', () => resolve(listener));
  });
  console.log('Server is running on port', PORT);
  return server;
}

if (require.main === module) {
  startServer().catch(error => {
    console.error('Unable to start server:', error.message);
    process.exit(1);
  });
}

module.exports = { startServer };
