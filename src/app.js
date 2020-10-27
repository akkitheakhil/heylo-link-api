const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const cors = require('cors');

// Environment Configuration Files 
require('dotenv').config();
const middlewares = require('./middlewares');
const api = require('./api');

// App Init Express
const app = express();

// Init Middlewares
app.use(morgan('combined'));
app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    message: 'Heylo-link API'
  });
});

app.use('/api/v1', api);

app.use(middlewares.notFound);
app.use(middlewares.errorHandler);

module.exports = app;
