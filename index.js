const path = require('path');
const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const yup = require('yup');
const cors = require('cors');

// DotEnv Config
require('dotenv').config();

// Init App
const app = express();

// Middlewares
app.use(helmet());
app.use(cors());
app.use(morgan('common'));
app.use(express.json());
app.use(express.static('./public'));

// End Points
app.get('/:id', (req, res, next) => {
    try {

        res.json({
            message: 'Heylo Link by Akhil Padmanabhan'
        })

    } catch(err) {
        next(err);
    }
});


// Error Handling
app.use((error, req, res, next) => {
    if (error.status) {
        res.status(error.status);
    } else {
        res.status(500);
    }
    res.json({
        message: error.message,
        stack: process.env.NODE_ENV === 'production' ? '🥞' : error.stack,
    });
});

// Port
const port = process.env.PORT || 1337;

// Server Init
app.listen(port, () => {
    console.log(`Listening at http://localhost:${port}`);
});