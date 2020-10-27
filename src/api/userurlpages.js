const express = require('express');
require('dotenv').config();
const monk = require('monk');
const yup = require('yup');
const slowDown = require("express-slow-down");
const rateLimit = require("express-rate-limit");
const { nanoid } = require('nanoid');
const db = monk(process.env.MONGO_URI);
const slugs = db.get('slugs');
slugs.createIndex('name');




// Rate Limiter
const limiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 60 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  });
   
// Limit Reponse Time 
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 100, // allow 100 requests per 15 minutes, then...
  delayMs: 500 // begin adding 500ms of delay per request above 100:
});


// Router Init
const router = express.Router();

// Schema Validation
const shortSchema = yup.object().shape({
    url: yup.string().trim().url().required(),
    name: yup.string().trim(),
});

const pageSchema = yup.object().shape({
    name: yup.string().trim().required(),
    coverpic: yup.string().trim().url(),
    profilepicture: yup.string().trim().url(),
    data: yup.array().of(yup.object().shape({
        url: yup.string().trim().url().required(),
        name: yup.string().trim().required(),
        icon: yup.string().trim().url(),
    })),
})


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


// Create Custom Short Links
// Users can only make 100 Links per hour
router.post('/shortlinks', limiter, async (req, res, next) => {
    let { url, name } = req.body;
    try {
        await shortSchema.validate({ url, name });
        name ? name = name.toLowerCase() : name = nanoid(6);
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


// Create Custom pages
// Users can only make 100 pages per hour
router.post('/pages', limiter, async (req, res, next) => {
    let { name, coverpic, profilepicture, data } = req.body;
    try {
        await pageSchema.validate({ name, coverpic, profilepicture, data });
        name ? name = name.toLowerCase() : name = nanoid(6);
        const existing = await slugs.findOne({ name });
        if (existing) {
            throw new Error('Custom Name already in use');
        }

        const type = 'page';
        const newLink = { name, type, coverpic, profilepicture, data };
        const created = await slugs.insert(newLink);
        res.json(created);
    } catch (error) {
        next(error);
    }

});



module.exports = router;