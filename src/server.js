const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const PATH = require('path');
const cors = require('cors');
const chrono = require('chrono-node');
const { createCanvas, Image } = require('canvas');

const encryption = require('./encryption');
const Auth = require('./auth');

// Load environment variables
require('dotenv').config();

// Create server
const app = express();
const server = http.createServer(app);
const io = new socketIo.Server(server, { cors: { origin: '*' } });

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// ---- Service ----

// Create a physical key
app.post('/nfc-key', (req, res) => {
	// If the admin device key doesn't match the one in the .env file, error
	if (req.body.admin_device_id !== process.env.ADMIN_DEVICE_ID) return res.status(403).send('Forbidden');

	// Create physical key
	const physical_key = encryption.createKey();

	// Send physical key in url
	res.send({ physical_key_url: `https://${process.env.AUTH_SERVER}/start/?key=${physical_key}` });
});

// Restrict access to service starting page
app.get('/start', (req, res, next) => {
	// Get the physical ssh key from the url
	const key = req.query.key;

	// If no key, act as not found
	if (!key) return res.status(404).send('Not found');

	// If the service already started, redirect so that the key is not leaked
	if (encryption.is_ready) return res.redirect('/started');

	// Continue
	next();
});

// Start the service
app.post('/start', (req, res) => {
	// Get the physical key and admin password
	const { physical_key_hex, admin_password, admin_device_id } = req.body;

	// Check if the admin device key matches the one in the .env file
	if (admin_device_id !== process.env.ADMIN_DEVICE_ID) return res.status(403).send('Forbidden');

	// Start encryption
	const verif = encryption.start(physical_key_hex, admin_password);

	// If the key is incorrect, error
	if (!verif) return res.status(403).send('Forbidden');

	// Send success
	res.send({ success: true });
	console.log('Service started');
});

// A middleware that prevents the route from being accessed if the service is not started
function ready(req, res, next) {
	// If the service is not started, error
	if (!encryption.is_ready) return res.status(503).send('Service not started');

	// Continue
	next();
}

// ---- Authentication ----

// Determine if email requires sign up or sign in
app.post('/email', ready, (req, res) => {
	// Get email
	const { email } = req.body;

	// If no email, error
	if (!email) return res.send('No email provided');

	// Check if email is in database and send sign in if found
	if (Auth.userExists(email)) return res.send({ action: 'sign in' });

	// Check if email is in beta accesss list and send sign up if found
	const beta = require('../users/beta-access.json');
	if (beta.includes(email)) return res.send({ action: 'sign up' });

	// Send refuse
	res.send({ error: 'refuse' });
});

// Authenticate user on app
app.post('/auth/:app', ready, (req, res) => {
	// Get nosuite auth token
	const { token } = req.body;

	// Process token
	const token_data = Auth.processToken(token, process.env.AUTH_SERVER);

	// If token is invalid, error
	if (!token_data.valid) return res.send('Invalid token');

	// Generate app token
	const app_token = Auth.generateToken(req.params.app, token_data.email, 7, token_data.hashed_password);

	// Send app token
	res.send({ token: app_token });
});

// Authenticate user on Nosuite
app.post('/auth', ready, (req, res) => {
	// Get email and password
	const { email, password, name } = req.body;

	// If no email or password, error
	if (!email || !password) return res.send({ error: 'No email or password provided' });

	// Verify that email is in beta access list
	const beta = require('../users/beta-access.json');
	if (!beta.includes(email)) return res.send({ error: 'refuse' });

	// Hash password
	const hashed_password = encryption.hashPassword(password);

	// If email exists, check password
	if (Auth.userExists(email)) {
		// Verify password
		if (!Auth.verifyPassword(email, hashed_password)) return res.send({ error: 'Invalid password' });
	}

	// If email not found, create user
	else {
		// Make user directory
		fs.mkdirSync(`./users/${email}`);

		// Create password verification encryption file
		encryption.writeJSON(`./users/${email}/verification.enc`, 'password', hashed_password);

		// Create account name file
		encryption.writeJSON(`./users/${email}/name.enc`, name, hashed_password);
	}

	// Create Nosuite token
	const token = Auth.generateToken(process.env.AUTH_SERVER, email, 90, hashed_password);

	// Send token
	res.send({ token });
});

// Get account info
app.post('/account-info', ready, (req, res) => {
	// Get token
	const token = req.body.token || req.headers.authorization?.split(' ')[1];

	// If no token, error
	if (!token) return res.send({ error: 'No token provided' });

	// Process token
	const data = Auth.processToken(token, Auth.getAppOrigin(req));

	// If token is invalid, error
	if (!data.valid) return res.send({ error: 'Invalid token' });

	const { email, hashed_password } = data;

	// Get account name
	const name = encryption.readJSON(`./users/${email}/name.enc`, hashed_password);

	// Send account info
	res.send({ email, name });
});

// ---- Fetch Storage ----

// Auth middleware
function auth(req, res, next) {
	// Get token
	const token = req.body.token || req.headers.authorization?.split(' ')[1];
	if (!token) return res.send({ error: 'No token provided' });

	// Process token
	req.auth = Auth.processToken(token, Auth.getAppOrigin(req));

	// If token is invalid, error
	if (!req.auth.valid) return res.send({ error: 'Invalid token' });

	// Get the path from the url
	req.url_path = req.path.replace('/storage', '');
	req.storage_root = PATH.join(__dirname, '..', 'users', req.auth.email, req.auth.origin);
	req.full_path = PATH.join(req.storage_root, req.url_path);

	// If full path is outside of storage root, error
	if (!req.full_path.startsWith(req.storage_root)) return res.send({ error: 'Forbidden' });

	// Continue
	next();
}

// Process request path
function processPath(req, prefix) {
	// Get the path from the url
	req.url_path = req.path.replace(prefix, '');
	req.storage_root = PATH.join(__dirname, '..', 'users', req.auth.email, req.auth.origin);
	req.full_path = PATH.join(req.storage_root, req.url_path);

	// If full path is outside of storage root, error
	if (!req.full_path.startsWith(req.storage_root)) return false;

	// Return true if path is valid
	return true;
}

// Get file
app.get('/storage/*', auth, (req, res) => {
	// Process path
	if (!processPath(req, '/storage')) return res.send({ error: 'Forbidden' });

	// Check if file exists
	if (!fs.existsSync(req.full_path) || !fs.statSync(req.full_path).isFile()) return res.send({ error: 'Not found' });

	// Read encrypted file
	res.send(encryption.readBuffer(req.full_path, req.auth.hashed_password));
});

// Get resized image (thumbnails, etc.)
app.get('/resized/:size/*', auth, async (req, res) => {
	// Get size
	const size = parseInt(req.params.size);

	// Process path
	if (!processPath(req, `/resized/${size}`)) return res.send({ error: 'Forbidden' });

	// Check if file exists
	if (!fs.existsSync(req.full_path) || !fs.statSync(req.full_path).isFile()) return res.send({ error: 'Not found' });

	// Read encrypted file
	const buffer = encryption.readBuffer(req.full_path, req.auth.hashed_password);

	// Resize image using canvas
	const img = new Image();
	await new Promise(resolve => {
		img.onload = resolve;
		img.src = buffer;
	});

	// Get the original image size
	const { width, height } = img;

	// Calculate the new size
	const [rw, rh] = width > height ? [size, (size * height) / width] : [(size * width) / height, size];

	const canvas = createCanvas(rw, rh);
	const ctx = canvas.getContext('2d');
	ctx.drawImage(img, 0, 0, rw, rh);

	// Send the resized image
	res.send(canvas.toBuffer());
});

// ---- Socket Storage ----

// Use sockets to handle storage commands
function onStorageCmd(socket, type, callback) {
	// Listen for command event and check token before executing callback
	socket.on(type, (cmd, res) => {
		// If no token, error
		if (!cmd.token) return res({ error: 'No token provided' });

		// Process token
		const token_data = Auth.processToken(cmd.token, cmd.app);

		// If token is invalid, error
		if (!token_data.valid) return res({ error: 'Invalid token' });

		// Attach token data to request
		cmd.auth = token_data;

		// Add socket to user room for file changes
		socket.join(token_data.email);

		// Set storage root and full path
		cmd.storage_root = PATH.join(__dirname, '..', 'users', token_data.email, cmd.app);
		cmd.full_path = PATH.join(cmd.storage_root, cmd.path);

		// If full path is outside of storage root, error
		if (!cmd.full_path.startsWith(cmd.storage_root)) return res({ error: 'Forbidden' });

		// Create app storage directory if it doesn't exist
		if (!fs.existsSync(cmd.storage_root)) fs.mkdirSync(cmd.storage_root);

		// Execute callback
		const needs_broadcast = callback(cmd, res);

		// If broadcast is needed, emit file change event
		if (needs_broadcast) {
			// Remove authentication data
			delete cmd.auth;
			delete cmd.token;

			io.to(token_data.email).emit('file-change', cmd);
		}
	});
}

// Client socket
io.on('connection', socket => {
	// If service is not started, error
	if (!encryption.is_ready) return setTimeout(() => socket.disconnect(), 1000);

	// Create directory
	onStorageCmd(socket, 'mkdir', (req, res) => {
		// Create directory if it doesn't exist
		if (!fs.existsSync(req.full_path)) fs.mkdirSync(req.full_path);

		// Send success
		res({ success: true });
		return false;
	});

	// List files in directory
	onStorageCmd(socket, 'ls', (req, res) => {
		// Check if path exists and is a directory
		if (!fs.existsSync(req.full_path) || !fs.statSync(req.full_path).isDirectory()) res({ error: 'Not found' });
		let files;

		try {
			// List files
			files = fs.readdirSync(req.full_path, { withFileTypes: true }).map(file => ({
				name: file.name,
				path: PATH.join(req.path, file.name),
				is_directory: file.isDirectory()
			}));
		} catch (e) {
			files = [];
		}

		// Send files
		res(files);
		return false;
	});

	// Read file
	onStorageCmd(socket, 'read', (req, res) => {
		// Check if file exists
		if (!fs.existsSync(req.full_path) || !fs.statSync(req.full_path).isFile()) res({ error: 'Not found' });

		// Read encrypted file
		const content = encryption.readJSON(req.full_path, req.auth.hashed_password);

		// Send content
		res({ content });
		return false;
	});

	// Write file
	onStorageCmd(socket, 'write', (req, res) => {
		// Write encrypted file
		encryption.writeJSON(req.full_path, req.content, req.auth.hashed_password);

		// Send success
		res({ success: true });
		return true;
	});

	// Write chunk of url_data
	onStorageCmd(socket, 'write-chunk', (req, res) => {
		const temp_path = req.full_path + '.temp';
		const { chunk, final } = req.content;

		// Write encrypted file
		fs.appendFileSync(temp_path, chunk);

		// Create the image file from the temp dataURL file if it's the final chunk
		if (final) {
			// Get the dataURL from the temp file
			const data_url = fs.readFileSync(temp_path, 'utf8');

			// Create the image file
			const buffer = Buffer.from(data_url.split(',')[1], 'base64');

			// Write the image file
			encryption.writeBuffer(req.full_path, buffer, req.auth.hashed_password);

			// Remove the temp file
			fs.rmSync(temp_path);
		}

		// Send success
		res({ success: true });
		return final;
	});

	// Remove file or directory
	onStorageCmd(socket, 'rm', (req, res) => {
		// Check if file exists
		if (!fs.existsSync(req.full_path)) {
			res({ error: 'Not found' });
			return false;
		}

		// Remove file or directory
		fs.rmSync(req.full_path, { recursive: true });

		// Send success
		res({ success: true });
		return true;
	});

	// Parse date NLP using chrono (both in English and French)
	socket.on('date-nlp', (text, res) => {
		const one_hour_offset = new Date(Date.now() + 3600000);

		// "midi" is not recognized by chrono, so we replace it with "12h00"
		const midi = text.includes('midi');
		text = text.replace(/midi/g, '12h00');

		// Parse in french first
		let parsed = chrono.fr.parse(text, one_hour_offset, { forwardDate: true })[0];

		// If no french date found, parse in english
		if (!parsed) parsed = chrono.parse(text, one_hour_offset, { forwardDate: true })[0];

		// If no date found, null
		if (!parsed) return res(null);

		// If "midi" was found, we need to put it back in the text
		if (midi) parsed.text = parsed.text.replace(/12h00/g, 'midi');

		// We need the date and the text
		res({
			date: parsed.start.date().getTime() - 3600000,
			text: parsed.text
		});
	});
});

// ---- Pages ----

// Prevent access to auth page if service is not started
app.get('/auth', ready);

// Serve public files
app.use(express.static('public'));

// Start the server
server.listen(8003, () => console.log('Server running on port 8003, please start the service'));
