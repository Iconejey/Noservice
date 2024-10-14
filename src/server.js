const express = require('express');
const app = express();
const fs = require('fs');
const cors = require('cors');
const { hashPassword, writeEncrypted, readEncrypted, userExists, verifyPassword, generateToken, getAppOrigin, processToken } = require('./encryption');

// Load environment variables
require('dotenv').config();

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Determine if email requires sign up or sign in
app.post('/email', (req, res) => {
	// Get email
	const { email } = req.body;

	// If no email, error
	if (!email) return res.status(400).send('No email provided');

	// Check if email is in database and send sign in if found
	const found = fs.readdirSync('./users').find(user => user === email);
	if (found) return res.send({ action: 'sign in' });

	// Check if email is in beta accesss list and send sign up if found
	const beta = require('../users/beta-access.json');
	if (beta.includes(email)) return res.send({ action: 'sign up' });

	// Send refuse
	res.send({ error: 'refuse' });
});

// Authenticate user on app
app.post('/auth/:app', (req, res) => {
	console.log(`Received auth request from ${req.params.app}`);

	// Get nosuite auth token
	const { token } = req.body;

	// Process token
	const token_data = processToken(token, 'nosuite.ngwy.fr');

	// If token is invalid, error
	if (!token_data.valid) return res.status(400).send('Invalid token');

	// Generate app token
	const app_token = generateToken(req.params.app, token_data.email, 7, token_data.hashed_password);

	// Send app token
	res.send({ token: app_token });
});

// Authenticate user on Nosuite
app.post('/auth', (req, res) => {
	// Get email and password
	const { email, password, name } = req.body;

	// If no email or password, error
	if (!email || !password) return res.status(400).send('No email or password provided');

	// Verify that email is in beta access list
	const beta = require('../users/beta-access.json');
	if (!beta.includes(email)) return res.send({ error: 'refuse' });

	// Hash password
	const hashed_password = hashPassword(password);

	// If email exists, check password
	if (userExists(email)) {
		// Verify password
		if (!verifyPassword(email, hashed_password)) return res.status(400).send({ error: 'Invalid password' });
	}

	// If email not found, create user
	else {
		// Make user directory
		fs.mkdirSync(`./users/${email}`);

		// Create password verification encryption file
		writeEncrypted(`./users/${email}/verification.enc`, 'password', hashed_password);

		// Create account name file
		writeEncrypted(`./users/${email}/name.enc`, name, hashed_password);
	}

	// Create Nosuite token
	const token = generateToken('nosuite.ngwy.fr', email, 90, hashed_password);

	// Send token
	res.send({ token });
});

// Get account info
app.post('/account-info', (req, res) => {
	// Get token
	const { token } = req.body;

	// If no token, error
	if (!token) return res.status(400).send('No token provided');

	// Process token
	const { email, hashed_password } = processToken(token, getAppOrigin(req));

	// Get account name
	const name = readEncrypted(`./users/${email}/name.enc`, hashed_password);

	// Send account info
	res.send({ email, name });
});

app.use(express.static('public'));

app.listen(8003, () => console.log('Server running on port 8003'));
