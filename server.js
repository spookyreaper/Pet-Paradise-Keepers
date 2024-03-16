require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const methodOverride = require('method-override');
const livereload = require('livereload');
const connectLiveReload = require('connect-livereload');

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

/* Create the Express app */
const app = express();

const session = require('express-session');
const MongoStore = require('connect-mongo');

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: 'auto' },
  store: MongoStore.create({ mongoUrl: MONGODB_URI })
}));


/* Database Connection */
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB connection error:', err));

/* Middleware */
app.use(express.json());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(connectLiveReload());
app.use('/uploads', express.static('public/uploads'));

/* View Engine Configuration */
app.set('view engine', 'ejs');

/* Routes */
const mainRouter = require('./routes/index');
app.use(mainRouter);
const dashboardRoutes = require('./routes/dashboardRoutes');


app.use('/dashboard', dashboardRoutes);


/* Error Handling Middlewares */

// Handle 404
app.use((req, res, next) => {
    res.status(404).send("Sorry can't find that!");
});

// General error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

/* LiveReload Configuration */
const liveReloadServer = livereload.createServer();
liveReloadServer.server.once("connection", () => {
    setTimeout(() => liveReloadServer.refresh("/"), 100);
});

/* Server Listen */
app.listen(PORT, () => {
    console.log('Server is running on port', PORT);
});
