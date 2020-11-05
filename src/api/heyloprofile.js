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
const analytics = db.get(process.env.MONGO_DB_ANALYTICS);
analytics.createIndex('name');
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

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
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

router.use('/', checkAuth);

// Schema Validation
const shortSchema = yup.object().shape({
    url: yup.string().trim().matches(
        /((https?):\/\/)?(www.)?[a-z0-9]+(\.[a-z]{2,}){1,3}(#?\/?[a-zA-Z0-9#]+)*\/?(\?[a-zA-Z0-9-_]+=[a-zA-Z0-9-%]+&?)?$/,
        'Please enter a valid url!').required('URL is required'),
    name: yup.string().trim(),
});

const pageSchema = yup.object().shape({
    name: yup.string().trim().required(),
    displayName: yup.string().trim().nullable(),
    data: yup.array().of(yup.object().shape({
        url: yup.string().trim().matches(
            /((https?):\/\/)?(www.)?[a-z0-9]+(\.[a-z]{2,}){1,3}(#?\/?[a-zA-Z0-9#]+)*\/?(\?[a-zA-Z0-9-_]+=[a-zA-Z0-9-%]+&?)?$/,
            'Please enter a valid url!').required('URL is required'),
        name: yup.string().trim().required(),
        icon: yup.string().trim().nullable(),
    })),
});


const addLinkSchema = yup.object().shape({
    url: yup.string().trim().matches(
        /((https?):\/\/)?(www.)?[a-z0-9]+(\.[a-z]{2,}){1,3}(#?\/?[a-zA-Z0-9#]+)*\/?(\?[a-zA-Z0-9-_]+=[a-zA-Z0-9-%]+&?)?$/,
        'Please enter a valid url!').required('URL is required to create a link'),
    name: yup.string().trim().required('Name is required to create a link'),
    icon: yup.string().trim(),
});


const editLinkSchema = yup.object().shape({
    url: yup.string().trim().matches(
        /((https?):\/\/)?(www.)?[a-z0-9]+(\.[a-z]{2,}){1,3}(#?\/?[a-zA-Z0-9#]+)*\/?(\?[a-zA-Z0-9-_]+=[a-zA-Z0-9-%]+&?)?$/,
        'Please enter a valid url!').required('URL is required'),
    name: yup.string().trim().required('Name is required to edit a link'),
    id: yup.string().trim().required(`Could not process your request`),
    icon: yup.string().trim(),
});

const changeOrderSchema = yup.object().shape({
    id: yup.string().trim().required(`Could not process your request`),
    toIndex: yup.number().required(`Could not process your request`),
    fromIndex: yup.number().required(`Could not process your request`),
})


// Create Custom Short Links
// Users can only make 100 Links per hour
router.post('/shortlinks', limiter, async (req, res, next) => {
    let { uid } = req.currentUser;
    let { url, name } = req.body;
    try {
        console.log(uid);
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

// Get pageinfo
router.get('/page', async (req, res, next) => {
    try {
        const { uid } = req.currentUser;
        const users = await user.findOne({ uid });
        const id = users.pagename;
        const items = await slugs.findOne({ name: id });
        // If found return else not found
        items ? res.json(items) : res.json({});

    } catch (error) {
        next(error);
    }
});


// Init Dashboard Details
router.get('/init', async (req, res, next) => {
    try {
        const { uid } = req.currentUser;
        const users = await user.findOne({ uid });
        if (users) {
            const name = users.pagename;
            const page = await slugs.findOne({ name });
            res.json({ users, page });
        } else {
            res.json({ users });
        }
    } catch (err) {
        next(err);
    }
});

// Get user or create user if not exist
router.get('/user', limiter, async (req, res, next) => {
    try {
        let { uid, email, displayName, photoURL, emailVerified } = currentUser;
        const existing = await user.findOne({ uid: uid });
        if (existing) {
            res.json(existing);
        } else {
            const newLink = { uid, email, displayName, photoURL, emailVerified };
            const created = await user.insert(newLink);
            res.json(created);
        }
    } catch (error) {
        next(error);
    }
});


// Create Page
router.post('/page', limiter, async (req, res, next) => {
    let { uid } = req.currentUser;
    let { name, displayName, data } = req.body;
    displayName = name;
    try {
        await pageSchema.validate({ name, displayName, data });
        const existing = await slugs.findOne({ name });
        const users = await user.find({ uid });
        if (existing) {
            throw new Error('This name has already been taken. Please choose another name');
        } else {
            if (users && users[0].pagename) {
                throw new Error('Only one Heylo Profile allowed per free account. Please upgrade to create more');
            } else {
                users[0].pagename = name;
                const urs = users[0];
                urs.pagename = name;
                const updateUser = await user.update({
                    _id: urs._id
                }, {
                    $set: urs
                });
                const type = 'page';
                const newLink = { name, type, displayName, data, uid };
                const pageinfo = await slugs.insert(newLink);
                res.json({ urs, pageinfo });
            }
        }
    } catch (error) {
        next(error);
    }
});


// Update Page Display Text
router.put('/page/displaytext', limiter, async (req, res, next) => {
    let { uid } = req.currentUser;
    let { displayName } = req.body;
    try {
        const users = await user.findOne({ uid });
        const pagename = users.pagename;
        const existing = await slugs.findOne({ name: pagename });
        if (existing) {
            if (isValidUserReq(uid, existing.uid)) {
                existing.displayName = displayName;
                const updateUser = await slugs.update({
                    _id: existing._id
                }, {
                    $set: existing
                });
                res.json(existing);
            } else {
                throw new Error(`You don't have premission to modify this data`);
            }

        } else {
            throw new Error('Please create a page before updating your Display Text');
        }

    } catch (err) {
        next(err)
    }
});

// Add new url link
router.put('/page/link/add', limiter, async (req, res, next) => {
    try {
        let { uid } = req.currentUser;
        let { url, name, icon } = req.body;
        await addLinkSchema.validate({ url, name, icon });
        const users = await user.findOne({ uid });
        const pagename = users.pagename;
        const existing = await slugs.findOne({ name: pagename });
        if (existing) {

            if (isValidUserReq(uid, existing.uid)) {
                const id = nanoid(11);
                const newData = { id, url, name, icon };

                if (!existing.data) {
                    existing.data = [];
                }

                existing.data.push(newData);
                const update = await slugs.update({
                    _id: existing._id
                }, {
                    $set: existing
                });
                res.json(existing);
            } else {
                throw new Error(`You don't have premission to modify this data`);
            }

        } else {
            throw new Error('Please create a page before adding links');
        }

    } catch (err) {
        next(err)
    }
});


// Edit existing url
router.put('/page/link/edit', limiter, async (req, res, next) => {
    let { uid } = req.currentUser;
    let { id, url, name, icon } = req.body;
    await editLinkSchema.validate({ id, url, name, icon });
    try {
        const users = await user.findOne({ uid });
        const pagename = users.pagename;
        const existing = await slugs.findOne({ name: pagename });
        const findItem = existing.data.find(x => x.id === id);
        if (existing && findItem) {

            if (isValidUserReq(uid, existing.uid)) {
                findItem.name = name;
                findItem.url = url;
                findItem.icon = icon;
                const index = existing.data.findIndex(x => x.id === id);
                existing.data[index] = findItem;
                const update = await slugs.update({
                    _id: existing._id
                }, {
                    $set: existing
                });
                res.json(existing);
            } else {
                throw new Error(`You don't have premission to modify this data`);
            }

        } else {
            throw new Error('No page or item found to edit.');
        }
    } catch (err) {
        next(err)
    }
});


// Delete existing url
router.delete('/page/link/delete/:id', limiter, async (req, res, next) => {
    let { uid } = req.currentUser;
    const { id } = req.params;
    try {
        const users = await user.findOne({ uid });
        const pagename = users.pagename;
        const existing = await slugs.findOne({ name: pagename });
        const findItem = existing.data.find(x => x.id === id);
        if (existing && findItem !== null) {
            if (isValidUserReq(uid, existing.uid)) {
                existing.data = existing.data.filter(x => x.id !== id);
                const update = await slugs.update({
                    _id: existing._id
                }, {
                    $set: existing
                });
                res.json(existing);
            } else {
                throw new Error(`You don't have premission to modify this data`);
            }
        } else {
            throw new Error('No page or item found to delete.');
        }
    } catch (err) {
        next(err)
    }
});


// Change Url Order
router.put('/page/link/changeorder', async (req, res, next) => {

    try {
        const { uid } = req.currentUser;
        const { id, toIndex, fromIndex } = req.body;

        await changeOrderSchema.validate({ id, toIndex, fromIndex });
        const users = await user.findOne({ uid });
        const pagename = users.pagename;
        const existing = await slugs.findOne({ name: pagename });
        // Move 
        let dataItem = existing.data;
        const item = dataItem.find(x => x.id === id);
        if (existing && item) {
            dataItem = dataItem.filter(x => x.id !== id);
            dataItem.splice(toIndex, 0, item)
            existing.data = dataItem;
            const update = await slugs.update({
                _id: existing._id
            }, {
                $set: existing
            });
            res.json(existing);
        } else {
            res.json(existing);
        }
    } catch (error) {
        next(err)
    }
});

router.put('/page/link/customize/profilepicture', async (req, res, next) => {

    try {
        const { uid } = req.currentUser;
        const { profilepicture } = req.body;
        const users = await user.findOne({ uid });
        const pagename = users.pagename;
        const existing = await slugs.findOne({ name: pagename });

        if (existing && profilepicture) {

            if (!existing.theme) {
                existing.theme = { profilepicture: '', coverpicture: '', covertheme: '' };
            }

            existing.theme.profilepicture = profilepicture;

            const update = await slugs.update({
                _id: existing._id
            }, {
                $set: existing
            });
            res.json(existing);
        } else {
            throw new Error('No page found to upload profile picture');
        }

    } catch (error) {
        next(error)
    }
});

router.put('/page/link/customize/coverpicture', async (req, res, next) => {

    try {
        const { uid } = req.currentUser;
        const { coverpicture } = req.body;
        const users = await user.findOne({ uid });
        const pagename = users.pagename;
        const existing = await slugs.findOne({ name: pagename });

        if (existing && coverpicture) {
            if (!existing.theme) {
                existing.theme = { profilepicture: '', coverpicture: '', covertheme: '' };
            }
            existing.theme.coverpicture = coverpicture;
            const update = await slugs.update({
                _id: existing._id
            }, {
                $set: existing
            });
            res.json(existing);
        } else {
            throw new Error('No page found to upload profile picture');
        }

    } catch (error) {
        next(error)
    }
});

router.put('/page/link/customize/covertheme', async (req, res, next) => {

    try {
        const { uid } = req.currentUser;
        const { covertheme } = req.body;
        const users = await user.findOne({ uid });
        const pagename = users.pagename;
        const existing = await slugs.findOne({ name: pagename });

        if (existing && covertheme) {
            if (!existing.theme) {
                existing.theme = { profilepicture: '', coverpicture: '', covertheme: '' };
            }
            existing.theme.coverpicture = '';
            existing.theme.covertheme = covertheme;
            const update = await slugs.update({
                _id: existing._id
            }, {
                $set: existing
            });
            res.json(existing);
        } else {
            throw new Error('No page found to upload profile picture');
        }

    } catch (error) {
        next(error)
    }
});

router.put('/page/link/customize/bodytheme', async (req, res, next) => {

    try {
        const { uid } = req.currentUser;
        const { bodytheme } = req.body;
        const users = await user.findOne({ uid });
        const pagename = users.pagename;
        const existing = await slugs.findOne({ name: pagename });

        if (existing && bodytheme) {
            if (!existing.theme) {
                existing.theme = { profilepicture: '', coverpicture: '', covertheme: '', bodytheme: '' };
            }
            existing.theme.bodytheme = bodytheme;
            const update = await slugs.update({
                _id: existing._id
            }, {
                $set: existing
            });
            res.json(existing);
        } else {
            throw new Error('No page found to upload profile picture');
        }

    } catch (error) {
        next(error)
    }
});


router.put('/page/link/customize/btntype', async (req, res, next) => {
    try {
        const { uid } = req.currentUser;
        const { btntype } = req.body;
        const users = await user.findOne({ uid });
        const pagename = users.pagename;
        const existing = await slugs.findOne({ name: pagename });

        if (existing && btntype) {
            if (!existing.theme) {
                existing.theme = { profilepicture: '', coverpicture: '', covertheme: '', btntype: '', };
            }
            existing.theme.coverpicture = '';
            existing.theme.btntype = btntype;
            const update = await slugs.update({
                _id: existing._id
            }, {
                $set: existing
            });
            res.json(existing);
        } else {
            throw new Error('No page found to upload profile picture');
        }

    } catch (error) {
        next(error)
    }
});

router.put('/page/link/customize/btncolor', async (req, res, next) => {
    try {
        const { uid } = req.currentUser;
        const { btncolor } = req.body;
        const users = await user.findOne({ uid });
        const pagename = users.pagename;
        const existing = await slugs.findOne({ name: pagename });

        if (existing && btncolor) {
            if (!existing.theme) {
                existing.theme = { profilepicture: '', coverpicture: '', covertheme: '', btncolor: '', };
            }
            existing.theme.coverpicture = '';
            existing.theme.btncolor = btncolor;
            const update = await slugs.update({
                _id: existing._id
            }, {
                $set: existing
            });
            res.json(existing);
        } else {
            throw new Error('No page found to upload profile picture');
        }

    } catch (error) {
        next(error)
    }
});

router.put('/page/link/customize/btntext', async (req, res, next) => {
    try {
        const { uid } = req.currentUser;
        const { btntext } = req.body;
        const users = await user.findOne({ uid });
        const pagename = users.pagename;
        const existing = await slugs.findOne({ name: pagename });

        if (existing && btntext) {
            if (!existing.theme) {
                existing.theme = { profilepicture: '', coverpicture: '', covertheme: '', btntext: '', };
            }
            existing.theme.coverpicture = '';
            existing.theme.btntext = btntext;
            const update = await slugs.update({
                _id: existing._id
            }, {
                $set: existing
            });
            res.json(existing);
        } else {
            throw new Error('No page found to upload profile picture');
        }

    } catch (error) {
        next(error)
    }
});

// Get pageinfo
router.get('/analytics', async (req, res, next) => {
    try {
        const { uid } = req.currentUser;
        const users = await user.findOne({ uid });
        const id = users.pagename;
        const items = await slugs.findOne({ name: id });
        if (items) {
            const analyticsData = await analytics.findOne({ name: id });
            analyticsData ? res.json(analyticsData) : res.json({});
        } else {
            res.json({});
        }

    } catch (error) {
        next(error);
    }
})





// TODO 
// write new data schema for all new APIS,
// Rewrite API endpoint names to something more meaningfull. 


let isValidUserReq = function (requid, docid) {
    return requid === docid;
}


module.exports = router;