const { GoogleGenerativeAI } = require('@google/generative-ai');

class AI {
	constructor(api_key) {
		// Initialize the model
		this.genAI = new GoogleGenerativeAI(api_key);

		this.prefered_model = 'gemini-2.0-flash-thinking-exp-01-21';
		this.backup_model = 'gemini-2.0-flash-lite-preview-02-05';
		this.last_model_error_time = null;
	}

	// Generate text content
	async generate(opt) {
		// Determine the model to use
		let model = this.prefered_model;
		if (this.last_model_error_time && Date.now() - this.last_model_error_time < 60000 * 2) {
			model = this.backup_model;
		}

		console.log('Using model:', model);

		// Create a generative model
		this.model = this.genAI.getGenerativeModel({ systemInstruction: opt.system, model });

		// Start generation
		const result = await this.model.generateContentStream(opt.prompt);
		return result.stream;
	}

	signalError() {
		this.last_model_error_time = Date.now();
	}
}

module.exports = AI;
