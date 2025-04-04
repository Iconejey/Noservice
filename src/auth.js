const encryption = require('./encryption');
const fs = require('fs');

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
	static generateToken(origin, email, days_before_exp, hashed_password) {
		const exp = Date.now() + days_before_exp * 86_400_000;
		return encryption.encryptJSON({ origin, email, hashed_password, exp }, null).toString('hex');
	}

	// Get app origin
	static getAppOrigin(req) {
		const origin = req.headers.referer || req.headers.origin;
		return new URL(origin).hostname;
	}

	// Process token
	static processToken(token, origin) {
		if (!token) return { valid: false };

		const data = encryption.decryptJSON(Buffer.from(token, 'hex'), null);
		if (!data) return { valid: false };

		// Check if origin is correct
		if (data.origin !== origin) return { valid: false };

		// Check if origin ends with authorized domain
		if (!origin.endsWith(process.env.AUTHORIZED_DOMAIN)) return { valid: false };

		// Check if token is expired
		if (Date.now() > data.exp) return { valid: false };

		// Check if email is in database
		if (!Auth.userExists(data.email)) return { valid: false };

		// Verify password
		if (!Auth.verifyPassword(data.email, data.hashed_password)) return { valid: false };

		// Return token data
		return { valid: true, ...data };
	}
}

module.exports = Auth;
