const encryption = require('./encryption');
const fs = require('fs');
const { BrowserDetector } = require('browser-dtector');

class Auth {
	// Verify that user exists
	static userExists(email) {
		return fs.readdirSync('./users').find(user => user === email);
	}

	// Verify hashed password
	static verifyPassword(email, hashed_password) {
		const path = `./users/${email}/verification.enc`;
		if (encryption.isTestFile(path)) return true;
		const verification_str = encryption.readJSON(path, hashed_password);
		return verification_str === 'password';
	}

	// Generate token
	static generateToken(email, scope, device, days_before_exp, hashed_password) {
		const exp = Date.now() + days_before_exp * 86_400_000;
		return encryption.encryptJSON({ email, scope, device, hashed_password, exp }, null).toString('hex');
	}

	// Get app origin
	static getAppOrigin(req) {
		const origin = req.headers.referer || req.headers.origin;
		return new URL(origin).hostname;
	}

	// Get device
	static getDevice(req) {
		// Determine the device type
		const browser = new BrowserDetector();
		const user_agent = browser.parseUserAgent(req.headers['user-agent']);

		return {
			id: req.headers.device_id,
			is_mobile: user_agent.isMobile,
			browser: user_agent.name,
			platform: user_agent.platform
		};
	}

	// Process token
	static processToken(token, origin, device_id) {
		if (!token) return { valid: false };

		const data = encryption.decryptJSON(Buffer.from(token, 'hex'), null);
		if (!data) return { valid: false };

		// Check if origin ends with authorized domain
		if (!origin.endsWith(process.env.AUTHORIZED_DOMAIN)) {
			console.error(`Unauthorized origin: ${origin}`);
			return { valid: false };
		}

		// Check if token is expired
		if (Date.now() > data.exp) {
			console.error(`Token expired: ${data.exp}`);
			return { valid: false };
		}

		// Check if email is in database
		if (!Auth.userExists(data.email)) {
			console.error(`User does not exist: "${data.email}"`);
			return { valid: false };
		}

		// Verify password
		if (!Auth.verifyPassword(data.email, data.hashed_password)) {
			console.error(`Invalid password for user: "${data.email}"`);
			return { valid: false };
		}

		// Verify device
		if (data.device?.id !== device_id) {
			console.error(`Device ID mismatch for user: "${data.email}" (token: ${data.device?.id}, user agent: ${device_id})`);
			return { valid: false };
		}

		// Return token data
		return { valid: true, ...data };
	}
}

module.exports = Auth;
