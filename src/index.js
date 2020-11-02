const app = require('./app');


app.set('trust proxy', 1); // only if you're behind a reverse proxy (Heroku, Bluemix, AWS if you use an ELB, custom Nginx setup, etc)

// Port
const port = process.env.PORT || 1337;

// Server Init
app.listen(port, () => {
    console.log(`Listening at http://localhost:${port}`);
});

app.timeout = 120000;