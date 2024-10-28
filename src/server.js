const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const PATH = require('path');
const cors = require('cors');
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

const user_sockets = new Map();

function getUserSockets(email) {
	// If email is already registered, return sockets
	let sockets = user_sockets.get(email);
	if (sockets) return sockets;

	// If email is not registered, add email to map and return empty array
	sockets = [];
	user_sockets.set(email, sockets);
	return sockets;
}

function emitUser(author_id, email, event, data) {
	for (const { socket, app, id } of getUserSockets(email)) {
		data.by_self = author_id === id;
		socket.emit(event, { app, ...data });
	}
}

io.on('connection', socket => {
	// If service is not started, error
	if (!encryption.is_ready) return socket.disconnect();

	socket.on('register', ({ token, app, id }) => {
		const token_data = Auth.processToken(token, app);
		if (!token_data.valid) return;

		const sockets = getUserSockets(token_data.email);
		sockets.push({ socket, app, id });

		socket.on('disconnect', () => {
			const index = sockets.findIndex(s => s.socket === socket);
			if (index !== -1) sockets.splice(index, 1);
		});
	});
});

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
		encryption.write(`./users/${email}/verification.enc`, 'password', hashed_password);

		// Create account name file
		encryption.write(`./users/${email}/name.enc`, name, hashed_password);
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
	const name = encryption.read(`./users/${email}/name.enc`, hashed_password);

	// Send account info
	res.send({ email, name });
});

// Authorization middleware
function auth(req, res, next) {
	// Get token
	const token = req.headers.authorization?.split(' ')[1];

	// If no token, error
	if (!token) return res.send({ error: 'No token provided' });

	// Process token
	const data = Auth.processToken(token, Auth.getAppOrigin(req));

	// If token is invalid, error
	if (!data.valid) return res.send({ error: 'Unauthorized' });

	// Verify that email is in database
	if (!Auth.userExists(data.email)) return res.send({ error: 'User not found' });

	// Verify that password is correct
	if (!Auth.verifyPassword(data.email, data.hashed_password)) return res.send({ error: 'Authentication info invalid' });

	// Attach data to request
	req.token_data = data;

	// Continue
	next();
}

// ---- Storage ----

// Storage middleware
function storage(req, res, next) {
	const user_email = req.token_data.email;
	const app_origin = Auth.getAppOrigin(req);

	// Set request storage id
	req.storage_id = req.query.id;

	// Set request app path
	req.app_path = req.params[0] || '.';

	// Set storage root
	req.storage_root = PATH.join(__dirname, '..', 'users', user_email, app_origin);

	// Set storage path
	req.storage_path = PATH.join(req.storage_root, req.app_path);

	// If storage path is outside of storage root, error
	if (!req.storage_path.startsWith(req.storage_root)) return res.send({ error: 'Forbidden' });

	// Create app storage directory if it doesn't exist
	if (!fs.existsSync(req.storage_root)) fs.mkdirSync(req.storage_root);

	// Continue
	next();
}

// Create directory
app.post('/mkdir/*', ready, auth, storage, (req, res) => {
	// Check if path exists
	if (fs.existsSync(req.storage_path)) return res.send({ success: true });

	// Create directory
	fs.mkdirSync(req.storage_path);

	// Send success
	emitUser(req.storage_id, req.token_data.email, 'file-change', { path: req.app_path, action: 'mkdir' });
	res.send({ success: true });
});

// List files in directory
app.get('/ls/*?', ready, auth, storage, (req, res) => {
	// Check if path exists and is a directory
	if (!fs.existsSync(req.storage_path) || !fs.statSync(req.storage_path).isDirectory()) return res.send({ error: 'Not found' });

	// List files
	const files = fs.readdirSync(req.storage_path, { withFileTypes: true }).map(file => ({
		name: file.name,
		path: PATH.join(req.app_path, file.name),
		is_directory: file.isDirectory()
	}));

	// Send files
	res.send(files);
});

// Read file
app.get('/read/*', ready, auth, storage, (req, res) => {
	// If path is not a file, error
	if (!fs.existsSync(req.storage_path) || fs.statSync(req.storage_path).isDirectory()) return res.send({ error: 'Not found' });

	// Read encrypted file
	const content = encryption.read(req.storage_path, req.token_data.hashed_password);

	// Send data
	res.send({ content });
});

// Write file
app.post('/write/*', ready, auth, storage, (req, res) => {
	// If path is not a file, error
	if (fs.existsSync(req.storage_path) && fs.statSync(req.storage_path).isDirectory()) return res.send({ error: 'Not found' });

	try {
		// Write encrypted file
		encryption.write(req.storage_path, req.body.content, req.token_data.hashed_password);

		// Send success
		emitUser(req.storage_id, req.token_data.email, 'file-change', { path: req.app_path, action: 'write', content: req.body.content });
		res.send({ success: true });
	} catch (error) {
		// Send error
		res.send({ error: error.message });
	}
});

// Delete file or directory
app.delete('/rm/*', ready, auth, storage, (req, res) => {
	// Check if path exists
	if (!fs.existsSync(req.storage_path)) return res.send({ error: 'Not found' });

	// Delete file or directory
	if (fs.statSync(req.storage_path).isDirectory()) fs.rmSync(req.storage_path, { recursive: true });
	else fs.unlinkSync(req.storage_path);

	// Send success
	emitUser(req.storage_id, req.token_data.email, 'file-change', { path: req.app_path, action: 'rm' });
	res.send({ success: true });
});

// ---- Pages ----

// Prevent access to auth page if service is not started
app.get('/auth', ready);

// Serve public files
app.use(express.static('public'));

// Start the server
server.listen(8003, () => console.log('Server running on port 8003'));
