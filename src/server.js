// NPM modules
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const PATH = require('path');
const cors = require('cors');
const chrono = require('chrono-node');
const { createCanvas, Image } = require('canvas');

// Load environment variables
require('dotenv').config();

// Local modules
const encryption = require('./encryption');
const Auth = require('./auth');
const AI = require('./ai');

// Initialize AI
const ai = new AI(process.env.GEMINI_API_KEY);

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

	// Get device
	const device = Auth.getDevice(req);

	// Process token
	const token_data = Auth.processToken(token, process.env.AUTH_SERVER, device.id);

	// If token is invalid, error
	if (!token_data.valid) return res.send({ error: 'Invalid token' });

	// Generate app token
	const is_demo = token_data.email === 'demo@nosuite.fr';
	const exp = is_demo ? (1 / 24 / 60) * 10 : 7;
	const app_token = Auth.generateToken(token_data.email, '', device, exp, token_data.hashed_password);

	// Id it is a demo account
	if (is_demo) {
		// Copy the template account into the demo account
		const demo_path = PATH.join(__dirname, '..', 'users', 'demo@nosuite.fr');
		const template_path = PATH.join(__dirname, '..', 'users', 'template@nosuite.fr');

		fs.rmSync(demo_path, { recursive: true, force: true });
		fs.mkdirSync(demo_path, { recursive: true });
		fs.cpSync(template_path, demo_path, { recursive: true });
		fs.writeFileSync(PATH.join(demo_path, 'name.enc'), 'Compte démo');
	}

	// Send app token
	res.send({ token: app_token });
});

// Authenticate user on Nosuite
app.post('/auth', ready, (req, res) => {
	// Get scope, password and account name (if sign up)
	let { email, password, name } = req.body;

	// Get device
	const device = Auth.getDevice(req);

	// Make sure this token is only usable from the auth service
	scope = process.env.AUTH_SERVER;

	// If no email or password, error
	if (!email || !password) return res.send({ error: 'No email or password provided' });

	// If no device id, error
	if (!device.id) return res.send({ error: 'No device id provided' });

	// Verify that email is in testers list
	const testers = JSON.parse(fs.readFileSync(PATH.join(__dirname, '..', 'users', 'testers.json'), 'utf8'));
	if (!testers.includes(email)) return res.send({ error: 'refuse' });

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

	// Add device to user devices
	Auth.addUserDevice(email, device, hashed_password);

	// Create Nosuite token
	const is_demo = email === 'demo@nosuite.fr';
	const exp = is_demo ? (1 / 24 / 60) * 1 : 90;
	const token = Auth.generateToken(email, scope, device, exp, hashed_password);

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
	const data = Auth.processToken(token, Auth.getAppOrigin(req), Auth.getDevice(req).id);

	// If token is invalid, error
	if (!data.valid) return res.send({ error: 'Invalid token' });

	const { email, scope, hashed_password } = data;
	const shared = !!scope.replace(process.env.AUTH_SERVER, '');

	// Get account name
	const name = encryption.readJSON(`./users/${email}/name.enc`, hashed_password);

	// Send account info
	res.send({ email, name, shared });
});

// ---- Fetch Storage ----

// Auth middleware
function auth(req, res, next) {
	// Get token
	const token = req.body.token || req.headers.authorization?.split(' ')[1];
	if (!token) return res.send({ error: 'No token provided' });

	// Process token
	req.auth = Auth.processToken(token, Auth.getAppOrigin(req), Auth.getDevice(req).id);

	// If token is invalid, error
	if (!req.auth.valid) return res.send({ error: 'Invalid token' });

	// Get the path from the url
	req.url_path = req.path.replace('/storage', '');
	req.storage_root = PATH.join(__dirname, '..', 'users', req.auth.email, Auth.getAppOrigin(req));
	req.full_path = PATH.join(req.storage_root, req.url_path);

	// If full path is outside of storage root, error
	if (!req.full_path.startsWith(req.storage_root)) return res.send({ error: 'Forbidden' });

	// Continue
	next();
}

// Process request path
function processPath(req, prefix) {
	// Get the path from the url
	req.url_path = decodeURIComponent(req.path.replace(prefix, ''));
	req.storage_root = PATH.join(__dirname, '..', 'users', req.auth.email, Auth.getAppOrigin(req));
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
	if (!fs.existsSync(req.full_path) || !fs.statSync(req.full_path).isFile()) {
		console.error(`File not found: ${req.full_path}`);
		return res.send({ error: 'Not found' });
	}

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

// Process storage command before executing callback
function processCmd(socket, cmd, res, callback) {
	// If no token, error
	if (!cmd.token) return res({ error: 'No token provided' });

	// Process token
	const token_data = Auth.processToken(cmd.token, cmd.app, cmd.device_id);

	// If token is invalid, error
	if (!token_data.valid) return res({ error: 'Invalid token' });

	// Attach token data to request
	cmd.auth = token_data;

	// Add socket to user room for file changes
	socket.join(cmd.auth.email);

	// Set storage root and full path
	cmd.path = decodeURIComponent(cmd.path);
	cmd.storage_root = PATH.join(__dirname, '..', 'users', cmd.auth.email, cmd.app);
	cmd.full_path = PATH.join(cmd.storage_root, cmd.path);

	// If full path is outside of storage root, error
	if (!cmd.full_path.startsWith(cmd.storage_root)) return res({ error: 'Forbidden' });

	// Create app storage directory if it doesn't exist
	if (!fs.existsSync(cmd.storage_root)) fs.mkdirSync(cmd.storage_root);

	let needs_broadcast = false;

	try {
		// Execute callback
		needs_broadcast = callback();
	} catch (err) {
		// Send error
		return res({ error: err.message });
	}

	// If broadcast is needed, emit file change event
	if (needs_broadcast) {
		// Remove authentication data
		delete cmd.auth;
		delete cmd.token;

		io.to(token_data.email).emit('file-change', cmd);
	}
}

// Client socket
io.on('connection', socket => {
	// If service is not started, error
	if (!encryption.is_ready) return setTimeout(() => socket.disconnect(), 1000);

	// Storage commands
	socket.on('storage', (cmds, res) => {
		const responses = [];

		for (const cmd of cmds) {
			processCmd(socket, cmd, res, () => {
				// Create directory
				if (cmd.type === 'mkdir') {
					// Create directory if it doesn't exist
					if (!fs.existsSync(cmd.full_path)) fs.mkdirSync(cmd.full_path);

					// Send success
					responses.push({ success: true });
					return false;
				}

				// List elements in a given directory
				if (cmd.type === 'ls') {
					// Check if path exists and is a directory
					if (!fs.existsSync(cmd.full_path) || !fs.statSync(cmd.full_path).isDirectory()) responses.push({ error: 'Not found' });
					let elems;

					// List elems
					try {
						elems = fs.readdirSync(cmd.full_path, { withFileTypes: true }).map(elem => ({
							name: elem.name,
							path: PATH.join(cmd.path, elem.name),
							is_directory: elem.isDirectory()
						}));
					} catch (e) {
						elems = [];
					}

					// Send elems
					responses.push(elems);
					return false;
				}

				// List recursively elements in a given directory
				if (cmd.type === 'ls-r') {
					// Check if path exists and is a directory
					if (!fs.existsSync(cmd.full_path) || !fs.statSync(cmd.full_path).isDirectory()) responses.push({ error: 'Not found' });

					const total_elems = [];
					let dirs_to_check = [cmd.path];

					while (dirs_to_check.length > 0) {
						const subdirs = [];

						for (const dir of dirs_to_check) {
							// Get the full path
							const full_path = PATH.join(cmd.storage_root, dir);

							// List elems
							try {
								const current_elems = fs.readdirSync(full_path, { withFileTypes: true }).map(file => ({
									name: file.name,
									path: PATH.join(dir, file.name),
									is_directory: file.isDirectory()
								}));

								// Add to total elems
								total_elems.push(...current_elems);

								// Add subdirs
								for (const elem of current_elems) if (elem.is_directory) subdirs.push(elem.path);
							} catch (e) {
								continue;
							}
						}

						// Update dirs to check
						dirs_to_check = subdirs;
					}

					// Send elems
					responses.push(total_elems);
					return false;
				}

				// Read file
				if (cmd.type === 'read') {
					// Check if file exists
					if (!fs.existsSync(cmd.full_path) || !fs.statSync(cmd.full_path).isFile()) responses.push({ error: 'Not found' });

					// Read encrypted file
					const content = encryption.readJSON(cmd.full_path, cmd.auth.hashed_password);

					// Send content
					responses.push({ content });
					return false;
				}

				// Write file
				if (cmd.type === 'write') {
					// Write encrypted file
					encryption.writeJSON(cmd.full_path, cmd.content, cmd.auth.hashed_password);

					// Send success
					responses.push({ success: true });
					return true;
				}

				// Write chunk of url_data
				if (cmd.type === 'write-chunk') {
					const temp_path = cmd.full_path + '.temp';
					const { chunk, final } = cmd;

					// Write encrypted file
					fs.appendFileSync(temp_path, chunk);

					// Create the image file from the temp dataURL file if it's the final chunk
					if (final) {
						// Get the dataURL from the temp file
						const data_url = fs.readFileSync(temp_path, 'utf8');

						// Create the image file
						const buffer = Buffer.from(data_url.split(',')[1], 'base64');

						// Write the image file
						encryption.writeBuffer(cmd.full_path, buffer, cmd.auth.hashed_password);

						// Remove the temp file
						fs.rmSync(temp_path);
					}

					// Send success
					responses.push({ success: true });
					return final;
				}

				// Remove file or directory
				if (cmd.type === 'rm') {
					// Check if file exists
					if (!fs.existsSync(cmd.full_path)) {
						responses.push({ error: 'Not found' });
						return false;
					}

					// Remove file or directory
					fs.rmSync(cmd.full_path, { recursive: true });

					// Send success
					responses.push({ success: true });
					return true;
				}
			});
		}

		// Send responses
		res(responses);
	});

	// Parse date NLP using chrono (both in English and French)
	socket.on('date-nlp', (data, res) => {
		let { date_str, timezone_offset } = data;

		// "midi" is not recognized by chrono, so we replace it with "12h00"
		const midi = date_str.includes('midi');
		date_str = date_str.replace(/midi/g, '12h00') + ' XYZ';

		// Parse in french first
		let parsed = chrono.fr.parse(date_str, new Date(), { forwardDate: true, timezones: { XYZ: -timezone_offset } })[0];

		// // If no french date found, parse in english
		// if (!parsed) parsed = chrono.parse(date_str, new Date(), { forwardDate: true, timezones: { XYZ: -timezone_offset } })[0];

		// If no date found, null
		if (!parsed) return res(null);

		// If "midi" was found, we need to put it back in the text
		if (midi) parsed.text = parsed.text.replace(/12h00/g, 'midi');

		// We need the date and the text
		res({
			date: parsed.start.date().getTime(),
			text: parsed.text.replace(' XYZ', '')
		});
	});

	// Generate text using AI
	socket.on('generate-text', async opt => {
		try {
			// Start generation
			const stream = await ai.generate(opt);

			// Send the text stream
			for await (const chunk of stream) {
				// Send the text chunk
				socket.emit(opt.id, chunk.text());
			}

			// End the stream
			socket.emit(opt.id, { final: true });
		} catch (e) {
			// If an error occurs, send it
			socket.emit(opt.id, { error: e.message });
			ai.signalError();
		}
	});
});

// ---- Pages ----

// Prevent access to auth page if service is not started
app.get('/auth', ready);

// Serve public files
app.use(express.static('public'));

// Start the server
server.listen(8003, () => console.log('Server running on port 8003, please start the service'));
