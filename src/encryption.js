const crypto = require('crypto');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

// Hash password
function hashPassword(password) {
	return crypto.createHash('sha256').update(password).digest('hex');
}

// Generate encryption key from private key and hashed password
function generateUserKey(hashed_password) {
	const private_key = Buffer.from(process.env.PRIVATE_KEY, 'hex');
	if (!hashed_password) return private_key;
	return crypto.scryptSync(hashed_password, private_key, 32);
}

// Encrypt data
function encrypt(data, hashed_password) {
	const iv = Buffer.from(process.env.IV, 'hex');
	const key = generateUserKey(hashed_password);
	const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
	const str_data = JSON.stringify(data);
	return Buffer.concat([cipher.update(str_data), cipher.final()]);
}

// Decrypt data
function decrypt(data, hashed_password) {
	const iv = Buffer.from(process.env.IV, 'hex');
	const key = generateUserKey(hashed_password);
	const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
	try {
		return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString());
	} catch (e) {
		return null;
	}
}

// Write encrypted data to file
function writeEncrypted(path, data, hashed_password) {
	fs.writeFileSync(path, encrypt(data, hashed_password));
}

// Read encrypted data from file
function readEncrypted(path, hashed_password) {
	if (!fs.existsSync(path)) return null;
	return decrypt(fs.readFileSync(path), hashed_password);
}

// Verify that user exists
function userExists(email) {
	return fs.readdirSync('./users').find(user => user.startsWith(email));
}

// Verify hashed password
function verifyPassword(email, hashed_password) {
	const verification_str = readEncrypted(`./users/${email}/verification.enc`, hashed_password);
	return verification_str === 'password';
}

// Generate token
function generateToken(email, hashed_password) {
	return encrypt({ email, hashed_password, date: Date.now() }, null).toString('hex');
}

// Process token
function processToken(token) {
	const data = decrypt(Buffer.from(token, 'hex'), null);
	if (!data) return { valid: false };

	// Check if token is expired (30 days)
	const date = new Date(data.date);
	const now = Date.now();
	if (now - date > 2_592_000_000) return { valid: false };

	// Check if email is in database
	if (!userExists(data.email)) return { valid: false };

	// Verify password
	if (!verifyPassword(data.email, data.hashed_password)) return { valid: false };

	// Return token data
	return { valid: true, ...data };
}

module.exports = { hashPassword, encrypt, decrypt, writeEncrypted, readEncrypted, userExists, verifyPassword, generateToken, processToken };
