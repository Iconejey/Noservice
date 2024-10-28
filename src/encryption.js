const crypto = require('crypto');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

class Encryption {
	// Check if private key is set
	get is_ready() {
		return this.private_key !== null;
	}

	constructor() {
		this.private_key = null;
		this.iv = Buffer.from(process.env.IV, 'hex');
	}

	// Hash password
	hashPassword(password) {
		return crypto.createHash('sha256').update(password).digest('hex');
	}

	// Create a physical ssh key from password and a new random private key
	createKey() {
		return crypto.randomBytes(32).toString('hex');
	}

	// Encrypt key with password
	encryptKeyWithPassword(key, hashed_password) {
		return crypto.pbkdf2Sync(hashed_password, key, 256, 32, 'sha256');
	}

	// Start encryption by encrypting private key with password from physical key
	start(physical_key_hex, admin_password) {
		// Construct private key
		const hashed_admin_password = this.hashPassword(admin_password);
		const physical_key = Buffer.from(physical_key_hex, 'hex');
		this.private_key = this.encryptKeyWithPassword(physical_key, hashed_admin_password);

		// Try to decrypt the private key verif to check if the key is correct
		const private_key_verif = Buffer.from(process.env.PRIVATE_KEY_VERIF, 'hex');
		const decrypted_private_key_verif = this.decrypt(private_key_verif, null);

		if (decrypted_private_key_verif !== process.env.ADMIN_DEVICE_ID) {
			this.private_key = null;
			return false;
		}

		return true;
	}

	// Generate encryption key from private key and hashed password
	generateUserKey(hashed_password) {
		if (!hashed_password) return this.private_key;
		return this.encryptKeyWithPassword(this.private_key, hashed_password);
	}

	// Encrypt data
	encrypt(data, hashed_password) {
		const user_key = this.generateUserKey(hashed_password);
		const cipher = crypto.createCipheriv('aes-256-cbc', user_key, this.iv);
		const str_data = JSON.stringify(data);
		return Buffer.concat([cipher.update(str_data), cipher.final()]);
	}

	// Decrypt data
	decrypt(data, hashed_password) {
		const user_key = this.generateUserKey(hashed_password);
		const decipher = crypto.createDecipheriv('aes-256-cbc', user_key, this.iv);
		try {
			return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString());
		} catch (e) {
			return null;
		}
	}

	// Determine if the path is a test file
	isTestFile(path) {
		return path.includes('/test@gmail.com/');
	}

	// Write encrypted data to file
	write(path, data, hashed_password) {
		if (!this.isTestFile(path)) data = this.encrypt(data, hashed_password);
		fs.writeFileSync(path, data);
	}

	// Read encrypted data from file
	read(path, hashed_password) {
		if (!fs.existsSync(path)) return null;

		const data = fs.readFileSync(path);
		if (this.isTestFile(path)) return data.toString();
		return this.decrypt(data, hashed_password);
	}
}

module.exports = new Encryption();
