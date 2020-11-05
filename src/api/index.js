const express = require('express');

const shorturl = require('./shorturl');
const custompage = require('./heyloprofile');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    message: 'API'
  });
});

router.use('/shortlinks', shorturl); // Public URL
router.use('/heyloprofile', custompage); // Private URL

module.exports = router;
