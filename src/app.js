/**
 * Main server file
 */
require('dotenv').config({ path: `./.env` });
const express = require('express');
const bodyParser = require('body-parser');
const route = require('./route');
const { server } = require('./config');
const cors = require('cors');
const app = express();

const http = require('http').createServer(app);

const reshelper = require('reshelper');

require('./db/connection');

app.use(reshelper);

const corsOptions = {
  origin: '*',
  credentials: true, //access-control-allow-credentials:true
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'x-www-form-urlencoded, Origin, X-Requested-With, Content-Type, Accept, Authorization, *'
  );
  if (req.method === 'OPTIONS') {
    res.header(
      'Access-Control-Allow-Methods',
      'GET, PUT, POST, PATCH, DELETE, OPTIONS'
    );
    res.setHeader('Access-Control-Allow-Credentials', true);
    return res.status(200).json({});
  }
  next();
});

app.use(express.json());

app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(bodyParser.json({ limit: '50mb', extended: true }));

app.use((req, res, next) => {
  const now = new Date().toISOString();
  console.log(`[${now}] [${req.method}] ${req.originalUrl}`);
  next();
});

app.use('/', route);

app.use('/images', express.static(process.cwd() + '/uploads'));

http.listen(server.port, () => {
  console.log(`server run at ${server.port}`);
});

const error = require('./middleware/error-handler');

// if error is not an instanceOf APIError, convert it.
app.use(error.converter);

// catch 404 and forward to error handler
app.use(error.notFound);

// error handler, send stacktrace only during development
app.use(error.handler);
