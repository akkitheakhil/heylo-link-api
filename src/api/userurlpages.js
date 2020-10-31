const express = require('express');
const monk = require('monk');
const yup = require('yup');
require('dotenv').config();
const slowDown = require("express-slow-down");
const rateLimit = require("express-rate-limit");
const { nanoid } = require('nanoid');
const db = monk(process.env.MONGO_URI);
const slugs = db.get(process.env.MONGO_DB);
const user = db.get(process.env.MONGO_DB_USER);
const admin = require("firebase-admin");
slugs.createIndex('name');
user.createIndex('uid');
var cookieParser = require('cookie-parser');
let currentUser = null;
// Firebase Config

admin.initializeApp({
    credential: admin.credential.cert({
        "type": process.env.FIREBASE_TYPE,
        "project_id": process.env.FIREBASE_PROJECT_ID,
        "private_key_id": process.env.FIREBASE_PRIVATE_KEY_ID,
        "private_key": process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        "client_email": process.env.FIREBASE_CLIENT_EMAIL,
        "client_id": process.env.FIREBASE_CLIENT_ID,
        "auth_uri": process.env.FIREBASE_AUTH_URI,
        "token_uri": process.env.FIREBASE_TOKEN_URI,
        "auth_provider_x509_cert_url": process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
        "client_x509_cert_url": process.env.FIREBASE_CLIENT_X509_CERT_URL
    }),
    databaseURL: "https://heylo-link.firebaseio.com"
});

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


// Firebase AuthCheck
function checkAuth(req, res, next) {

    if ( req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        const idToken = req.headers.authorization.split('Bearer ')[1];
        admin.auth().verifyIdToken(idToken)
            .then((data) => {
                currentUser = data;
                req['currentUser'] = data;
                next()
            }).catch(() => {
                res.status(403).send({ errorStatus: 'Unauthorized', message: 'User not logged in or not a valid user' })
            });
    } else {
        res.status(403).send({ errorStatus: 'Unauthorized', message: 'User not logged in or not a valid user' })
    }
}

// Router Init
const router = express.Router();
router.use(cookieParser());

router.use('/', checkAuth)

// Schema Validation
const shortSchema = yup.object().shape({
    url: yup.string().trim().matches(
        /((https?):\/\/)?(www.)?[a-z0-9]+(\.[a-z]{2,}){1,3}(#?\/?[a-zA-Z0-9#]+)*\/?(\?[a-zA-Z0-9-_]+=[a-zA-Z0-9-%]+&?)?$/,
        'Please enter a valid url!').required('URL is required'),
    name: yup.string().trim(),
});

const pageSchema = yup.object().shape({
    name: yup.string().trim().required(),
    coverpic: yup.string().trim().url().nullable(),
    profilepicture: yup.string().trim().url().nullable(),
    data: yup.array().of(yup.object().shape({
        url: yup.string().trim().matches(
            /((https?):\/\/)?(www.)?[a-z0-9]+(\.[a-z]{2,}){1,3}(#?\/?[a-zA-Z0-9#]+)*\/?(\?[a-zA-Z0-9-_]+=[a-zA-Z0-9-%]+&?)?$/,
            'Please enter a valid url!').required('URL is required'),
        name: yup.string().trim().required(),
        icon: yup.string().trim().nullable(),
    })),
})


// Get Slug or Page by ID
router.get('/:id', async (req, res, next) => {
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
            throw new Error('This name has already been taken. Please choose another name');
        }

        const type = 'page';
        const newLink = { name, type, coverpic, profilepicture, data };
        const created = await slugs.insert(newLink);
        res.json(created);
    } catch (error) {
        next(error);
    }

});

router.put('/pages/:id', limiter, async (req, res, next) => {
    try {
        const { id } = req.params;
        console.log(id)
        let { name, coverpic, profilepicture, data } = req.body;
        await pageSchema.validate({ name, coverpic, profilepicture, data });
        const existing = await slugs.findOne({ name: id });
        console.log(existing)
        name = id;
        if (!existing) {
            return next();
        }

        const type = 'page';
        const newData = { name, type, coverpic, profilepicture, data };
        const updated = await slugs.update({
            _id: existing._id
        }, {
            $set: newData
        });
        res.json(newData);
    } catch (error) {
        next(error);
    }

});

router.post('/users', limiter, async (req, res, next) => {

    try {
        let { uid, email, displayName, photoURL, emailVerified } = req.body;
        if (currentUser.uid === uid) {
            const existing = await user.findOne({ uid: uid });
            if (existing) {
                throw new Error('User already exists');
            }
            const newLink = { uid, email, displayName, photoURL, emailVerified };
            const created = await user.insert(newLink);
            res.json(created);
        } else {
            res.status(403).send({ errorStatus: 'Unauthorized', message: 'You do not have premission to access this data' });
        }

    } catch (error) {
        next(error);
    }
});


router.put('/users/:id', limiter, async (req, res, next) => {

    try {
        const { id } = req.params;
        if (currentUser.uid === id) {
            let { email, displayName, photoURL, emailVerified, pagename } = req.body;
            const existing = await user.findOne({ uid: id });
            const slugName = await slugs.findOne({ name: pagename });
            if (!existing) {
                return next();
            }

            if(existing.pagename && existing.pagename !== pagename) {
                throw new Error(`Only one profile allowed per user.`);
            } else if(slugName) {
                throw new Error(`Sorry this name has already been taken. Please use another name.`);
            }
            const newData = { id, email, displayName, photoURL, emailVerified, pagename };
            const updated = await user.update({
                _id: existing._id
            }, {
                $set: newData
            });
            res.json(newData);
        } else {
            res.status(403).send({ errorStatus: 'Unauthorized', message: 'You do not have premission to access this data' });
        }

    } catch (error) {
        next(error);
    }
});

// Get User by UID
router.get('/users/:uid', speedLimiter, async (req, res, next) => {
    try {
        const { uid } = req.params;
        if (currentUser.uid === uid) {
            const items = await user.find({ uid });
            // If found return else not found
            items.length > 0 ? res.json(items) : next();
        } else {
            res.status(403).send({ errorStatus: 'Unauthorized', message: 'You do not have premission to access this data' })
        }

    } catch (err) {
        next(err);
    }
});


module.exports = router;