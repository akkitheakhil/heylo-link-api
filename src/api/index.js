const express = require('express');

const shorturl = require('./shorturl');
const custompage = require('./userurlpages');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    message: 'API'
  });
});

router.use('/shortlinks', shorturl); // Public URL
router.use('/userurlpages', custompage); // Private URL

module.exports = router;
