const path = require('node:path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const methodOverride = require('method-override');
const multer = require('multer');
const { discardUploads } = require('./utils/upload');

function createApp({ sessionStore, sessionSecret = process.env.SESSION_SECRET } = {}) {
  if (!sessionSecret) throw new Error('SESSION_SECRET is required.');
  if (!sessionStore && !process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');

  const app = express();
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.locals.user = null;
  app.locals.title = 'Pet Paradise Keepers';
  app.locals.errorMessage = null;

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(methodOverride('_method'));
  app.use(methodOverride(req => {
    if (req.method === 'POST' && typeof req.body?._method === 'string') {
      const method = req.body._method;
      delete req.body._method;
      return method;
    }
  }));
  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: 'auto', httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 },
    store: sessionStore || MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
  }));

  if (process.env.ENABLE_LIVERELOAD === 'true' && process.env.NODE_ENV !== 'production') {
    app.use(require('connect-livereload')());
  }

  app.use(require('./routes/index'));
  app.use('/dashboard', require('./routes/dashboardRoutes'));
  app.use(require('./routes/marketplaceRoutes'));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Page not found', message: 'We could not find that page.' });
  });

  app.use(async (error, req, res, next) => {
    await discardUploads(req);
    if (res.headersSent) return next(error);
    let status = error.status || error.statusCode || 500;
    let message = error.message;
    if (error instanceof multer.MulterError) {
      status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      message = error.code === 'LIMIT_FILE_SIZE' ? 'Photos must be 5 MB or smaller.' : 'Please check the uploaded files.';
    } else if (error.name === 'ValidationError' || error.name === 'CastError') {
      status = 400;
      message = 'Please check the information you entered.';
    }
    if (!Number.isInteger(status) || status < 400 || status > 599) status = 500;
    if (status >= 500) {
      console.error(error);
      message = 'Something went wrong. Please try again.';
    }
    return res.status(status).render('error', { title: 'Something went wrong', message });
  });

  return app;
}

module.exports = { createApp };
