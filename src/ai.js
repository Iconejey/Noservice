const { GoogleGenerativeAI } = require('@google/generative-ai');

class AI {
	constructor(api_key) {
		// Initialize the model
		this.genAI = new GoogleGenerativeAI(api_key);

		this.models = [
			{ name: 'gemini-2.0-flash-thinking-exp-01-21', last_error_time: 0 },
			{ name: 'gemini-2.0-flash-lite-preview-02-05', last_error_time: 0 },
			{ name: 'gemini-2.0-flash-exp', last_error_time: 0 },
			{ name: 'gemini-1.5-flash', last_error_time: 0 }
		];
	}

	// Get the model first in the list that has not errored in the last 2 minutes
	get prefered_model() {
		return this.models.find(model => Date.now() - model.last_error_time > 60000 * 2);
	}

	// Generate text content
	async generate(opt) {
		// Determine the model to use
		let model = this.prefered_model;
		if (!model) throw new Error('All models are in error state');
		console.log('Using model:', model.name);

		try {
			// Create a generative model
			this.model = this.genAI.getGenerativeModel({ systemInstruction: opt.system, model: model.name });

			// Start generation
			const result = await this.model.generateContentStream(opt.prompt);
			return result.stream;
		} catch (error) {
			// If 503 error, try another model
			if (error.status === 503) {
				model.last_error_time = Date.now();
				console.error(
					'503 error, trying another model',
					this.models.map(m => ({ name: m.name, minutes_since_error: (Date.now() - m.last_error_time) / 60000 }))
				);
				return this.generate(opt);
			}

			console.error(error);
		}
	}

	signalError() {
		this.last_model_error_time = Date.now();
	}
}

module.exports = AI;
