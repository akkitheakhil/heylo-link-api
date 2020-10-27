const express = require('express');
require('dotenv').config();
const monk = require('monk');
const { nanoid } = require('nanoid');
const slowDown = require("express-slow-down");
const rateLimit = require("express-rate-limit");
const db = monk(process.env.MONGO_URI);
const slugs = db.get('slugs');
const yup = require('yup');
slugs.createIndex('name');



// Rate Limiter
const limiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 60 minutes
    max: 10 // limit each IP to 10 requests per windowMs
  });
   
// Limit Reponse Time 
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 10, // allow 10 requests per 15 minutes, then...
  delayMs: 500 // begin adding 500ms of delay per request above 100:
});

const router = express.Router();

// Schema Validation
const schema = yup.object().shape({
    url: yup.string().trim().url().required(),
    name: yup.string().trim(),
});


// Get Slug or Page by ID
router.get('/:id', speedLimiter, async (req, res, next) => {
    try {
        const { id } = req.params;
        const items = await slugs.find({ name: id });
        // If found return else not found
        items.length > 0 ? res.json(items) : next();

    } catch (err) {
        next(err);
    }
});

// Create Page
// Free users can only make 10 Links per hour
router.post('/', limiter, async (req, res, next) => {
    let { url, name } = req.body;
    try {
        await schema.validate({ url, name });
        name ? name.toLowerCase() : name = nanoid(6);
        const existing = await slugs.findOne({ name });
        if (existing) {
            throw new Error('Custom Name already in use');
        }
        const type = 'shortlink';
        const newLink = { url, name, type };
        const created = await slugs.insert(newLink);
        res.json(created);
    } catch (error) {
        next(error);
    }
});


module.exports = router;
