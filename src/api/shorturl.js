const express = require('express');
require('dotenv').config();
const monk = require('monk');
const { nanoid } = require('nanoid');
const slowDown = require("express-slow-down");
const rateLimit = require("express-rate-limit");
const db = monk(process.env.MONGO_URI);
const slugs = db.get(process.env.MONGO_DB);
const analytics = db.get(process.env.MONGO_DB_ANALYTICS);
const yup = require('yup');
const e = require('express');
slugs.createIndex('name');
analytics.createIndex('name');


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
    url: yup.string().trim().matches(
        /((https?):\/\/)?(www.)?[a-z0-9]+(\.[a-z]{2,}){1,3}(#?\/?[a-zA-Z0-9#]+)*\/?(\?[a-zA-Z0-9-_]+=[a-zA-Z0-9-%]+&?)?$/,
        'Please enter a valid url!').required('URL is required'),
});


// Get Slug or Page by ID
router.get('/:id', speedLimiter, async (req, res, next) => {
    try {
        const { id } = req.params;
        const items = await slugs.find({ name: id });
        // If found return else not found
        const analyticCount = await increaseClickCounter(id);
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
        await schema.validate({ url });
        name = nanoid(6);
        const existing = await slugs.findOne({ name });
        if (existing) {
            throw new Error('Name already in use. Please try again');
        }
        const type = 'shortlink';
        const newLink = { url, name, type };
        const created = await slugs.insert(newLink);
        res.json(created);
    } catch (error) {
        next(error);
    }
});

// For Analytics
let increaseClickCounter = function (slugName) {
    return new Promise(async function (resolve, reject) {
        try {
            const item = await analytics.findOne({ name: slugName });
            if (!item) {
                let name, count, lastClicked;
                lastClicked = new Date();
                name = slugName;
                count = 1;
                const newData = { name, count, lastClicked };
                const created = await analytics.insert(newData);
                resolve(created);
            } else {
                let { name, count, lastClicked } = item;
                count = count + 1; // Update Click Counter
                lastClicked = new Date();
                const newData = { name, count, lastClicked };
                const updated = await analytics.update({
                    _id: item._id
                }, {
                    $set: newData
                });
                resolve(updated);
            }
        } catch (error) {
            resolve(error);
        }
    });
}


router.put('/analytics/:id', limiter, async (req, res, next) => {
    try {
        const { id } = req.params;
    let { index, url, name } = req.body;
    let item = await analytics.findOne({ name: id });
    const existing = await slugs.findOne({ name: id });
    if(!item) {
        if(existing && existing.data ) {
            if(existing.data.length > 0 && existing.data[index]) {
                const analyticCount = await increaseClickCounter(id);
                item = await analytics.findOne({ name: id });
            }
        }
    } 

    if (item) {
        if (item.data && item.data.length > 0) {
            const dataItem = item.data.findIndex(x => x.name === name && x.url === url);
            if (dataItem > -1) {
                item.data[dataItem].count += 1;
                item.data[dataItem].lastClicked = new Date();
                const updated = await analytics.update({
                    _id: item._id
                }, {
                    $set: item
                });
                res.json(updated);
            } else {
                let lastClicked, count;
                lastClicked = new Date();
                count = 1;
                const newData = { name: name, url: url, lastClicked: lastClicked, count: count };
                item.data.push(newData);
                const updated = await analytics.update({
                    _id: item._id
                }, {
                    $set: item
                });
                res.json(updated);
            }
        } else {
            item.data = [];
            let lastClicked, count;
            lastClicked = new Date();
            count = 1;
            const newData = { name: name, url: url, lastClicked: lastClicked, count: count };
            item.data.push(newData);
            const updated = await analytics.update({
                _id: item._id
            }, {
                $set: item
            });
            res.json(updated);
        }
    } 
    } catch (error) {
        next(error);
    }
});



module.exports = router;
