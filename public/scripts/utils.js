/*
Tag function for HTML text.
Used for syntax highlighting, code completion and formatting.
Mostly used with HTMLElement.innerHTML and inside a component constructor:

this.innerHTML = html`
    <div class="my-class">
        <span>Hello World</span>
    </div>
`;

Also handles self closing custom elements (no need to add a closing tag):

this.innerHTML = html`
    <text-input id="user-email" type="email" icon="email" />
    <node-panel content="btn:done/save-account" accent="blue" />
`;
*/
function html(strings, ...values) {
	// Get text
	let text = strings.reduce((acc, str, i) => acc + str + (values[i] || ''), '');

	// Handle self closing custom elements (ignore native self closing elements)
	return text.replaceAll(/<(\w+-[\w-]+)[^>]*\/>/gm, (match, tag) => match.replace('/>', `></${tag}>`));
}

// Escape HTML
function escapeHTML(md) {
	return md.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/*
Tag function to render HTML code
Allow to use HTML code to create an HTMLElement
Quicker than using document.createElement and appendChild
Uses the html tag function to create the text and handle self closing custom elements

const div = render`
    <div class="my-class">
        <span>Hello World</span>
    </div>
`;
*/
function render(html_str) {
	const div = document.createElement('div');
	div.innerHTML = html_str;
	const elem = div.firstElementChild;
	elem.remove();
	return elem;
}

// Define component with getters and setters for attributes and classes
// Example: defineComponent(html`<my-component value-attr bool-attr? .my-class />`);
function defineComponent(map) {
	// Get tag name
	const tag = /<([\w-]+)[^>]*>/.exec(map)[1];

	// Deduce class name
	const class_name = tag
		.split('-')
		.map(s => s[0].toUpperCase() + s.slice(1))
		.join('');

	// Get class from string
	const cls = eval(class_name);

	// Define custom element
	customElements.define(tag, cls);

	// Get attributes
	const attrs = map
		.replace(/<[\w-]+/, '')
		.replace(/><\/[\w-]+>/, '')
		.split(' ')
		.filter(Boolean);

	// Add getters and setters for attributes and classes
	for (const attr of attrs) {
		// Get attribute name
		const name = attr.replace(/[\?\.]/, '').replaceAll('-', '_');

		// If class
		if (attr.includes('.')) {
			Object.defineProperty(cls.prototype, name, {
				get() {
					return this.classList.contains(name);
				},

				set(value) {
					this.classList.toggle(name, value);
				}
			});
		}

		// If boolean attribute
		else if (attr.includes('?')) {
			Object.defineProperty(cls.prototype, name, {
				get() {
					return this.hasAttribute(name);
				},

				set(value) {
					this.toggleAttribute(name, value);
				}
			});
		}

		// If value attribute
		else {
			Object.defineProperty(cls.prototype, name, {
				get() {
					return this.getAttribute(name);
				},

				set(value) {
					this.setAttribute(name, value);
				}
			});
		}
	}
}

// Add $() function to HTMLElement prototype
Object.defineProperty(HTMLElement.prototype, '$', {
	get() {
		return this.querySelector.bind(this);
	}
});

// Add $$() function to HTMLElement prototype
Object.defineProperty(HTMLElement.prototype, '$$', {
	get() {
		return this.querySelectorAll.bind(this);
	}
});

// Same for ShadowRoot prototype
Object.defineProperty(ShadowRoot.prototype, '$', {
	get() {
		return this.querySelector.bind(this);
	}
});

Object.defineProperty(ShadowRoot.prototype, '$$', {
	get() {
		return this.querySelectorAll.bind(this);
	}
});

// $() function
function $(selector) {
	return document.querySelector(selector);
}

// $$() function
function $$(selector) {
	return document.querySelectorAll(selector);
}

class CustomElement extends HTMLElement {
	static ready = false;

	constructor() {
		super();
	}

	whenReady(callback) {
		if (CustomElement.ready) callback();
		else window.addEventListener('load', () => callback());
	}

	attributeChangedCallback(name, oldVal, newVal) {
		this.whenReady(() => {
			const title_case = name.slice(0, 1).toUpperCase() + name.slice(1);
			this[`on${title_case}Change`]?.(newVal);
		});
	}
}

window.addEventListener('load', () => {
	CustomElement.ready = true;
});

const body_class = document.body.classList;

// Fetch JSON
async function fetchJSON(url, options) {
	options = options || {};

	options.headers = {
		...options.headers,
		'Content-Type': 'application/json',
		Authorization: `Bearer ${localStorage.getItem('token')}`
	};

	options.body &&= JSON.stringify(options.body);

	const res = await fetch(url, options);
	if (!res.ok) return { error: res.statusText };

	try {
		const json = await res.json();
		if (json?.error) console.error(json.error);

		// Unothorized
		if (location.hostname !== 'nosuite.ngwy.fr' && json.error === 'Invalid token') {
			localStorage.removeItem('token');
			alert('Votre session a expiré, veuillez vous reconnecter.');
			return location.reload();
		}

		return json;
	} catch (err) {
		console.error(err);
		return { error: 'Invalid JSON' };
	}
}

// Fetch blob
async function fetchBlob(url) {
	const options = {
		headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
	};

	const res = await fetch(url, options);
	if (!res.ok) return { error: res.statusText };

	// Create a blob from the response
	return await res.blob();
}

function delay(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// Get the cursor position
function getCursorPosition(elem) {
	try {
		// Get the current selection object
		let selection = getSelection();

		// // If the selection is not a caret, return -1
		// if (selection.type !== 'Caret') return -1;

		// Get the range object representing the current selection
		const range = selection.getRangeAt(0);
		// Create a clone of the range before the selection
		const preSelectionRange = range.cloneRange();

		// Select all the contents of the element
		preSelectionRange.selectNodeContents(elem);
		// Set the end of the range to the start of the current selection
		preSelectionRange.setEnd(range.startContainer, range.startOffset);

		// Calculate the offset of the cursor position by getting the length of the range contents
		return preSelectionRange.toString().length;
	} catch (err) {
		return -1;
	}
}

// Set the cursor position
function setCursorPosition(elem, cursorOffset) {
	if (cursorOffset < 0) return;

	// Create a range object and select the contents of the element
	const range = document.createRange();
	range.selectNodeContents(elem);

	// Create a TreeWalker to traverse the element and its descendants
	const walker = document.createTreeWalker(elem, NodeFilter.SHOW_TEXT, null, false);

	let currentNode;
	let offset = 0;

	// Traverse the TreeWalker until the offset is reached
	while ((currentNode = walker.nextNode())) {
		const nodeLength = currentNode.length;

		// If the current node's length combined with the offset exceeds the target offset,
		// set the range and selection accordingly and exit the loop
		if (offset + nodeLength >= cursorOffset) {
			range.setStart(currentNode, cursorOffset - offset);
			range.setEnd(currentNode, cursorOffset - offset);
			const selection = getSelection();
			selection.removeAllRanges();
			selection.addRange(range);
			break;
		}

		offset += nodeLength;
	}
}

// ---- COLOR SCHEME ----

let scheme = null;

// Hex to RGB
function hexToRgb(hex) {
	const bigint = parseInt(hex.slice(1), 16);
	return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

// RGB to Hex
function rgbToHex(r, g, b) {
	return '#' + ((r << 16) + (g << 8) + b).toString(16).padStart(6, '0');
}

// Mix two colors
function mixColors(color1, color2, weight) {
	const [r1, g1, b1] = hexToRgb(color1);
	const [r2, g2, b2] = hexToRgb(color2);

	const r = Math.round(r1 * weight + r2 * (1 - weight));
	const g = Math.round(g1 * weight + g2 * (1 - weight));
	const b = Math.round(b1 * weight + b2 * (1 - weight));

	return rgbToHex(r, g, b);
}

// Load color scheme
async function loadColorScheme() {
	scheme = await fetchJSON('https://nosuite.ngwy.fr/theme.json');
	if (scheme.error) return alert('Erreur lors du chargement du thème : ' + scheme.error);

	let light_values = '';
	let dark_values = '';
	let accents = '';

	for (const name of scheme.names) {
		const light = scheme.light[name];
		const dark = scheme.dark[name];

		light_values += `--${name}: ${light};`;
		dark_values += `--${name}: ${dark};`;

		// If the color is an accent color
		if (!name.includes('-')) {
			light_values += `--${name}-trans: ${light}40;`;
			light_values += `--${name}-txt: ${mixColors(light, scheme.light['txt-2'], 0.5)};`;

			dark_values += `--${name}-trans: ${dark}30;`;
			dark_values += `--${name}-txt: ${mixColors(dark, scheme.dark['txt-2'], 0.5)};`;

			accents += `[accent="${name}"] {
				--accent: var(--${name});
				--accent-trans: var(--${name}-trans);
				--accent-txt: var(--${name}-txt);
			}`;
		}
	}

	document.head.appendChild(
		render(html`<style>
			html { ${accents} }
			body { ${light_values} }
			body.dark { ${dark_values} }
		</style>`)
	);
}

loadColorScheme();

// ---- AUTHENTICATION ----

// Navigate to auth service
function openAuthWindow() {
	location.href = `https://nosuite.ngwy.fr/auth?app=${location.host}`;
}

// Check if user is signed in
function userSignedIn() {
	return !!localStorage.getItem('token');
}

// Authenticate user
async function authenticate(force = false) {
	// Nosuite auth service
	if (force || !userSignedIn()) return openAuthWindow();
	return userSignedIn();
}

// Sign out
function signOut() {
	localStorage.removeItem('token');
	location.reload();
}

// Get account info
function getAccountInfo(token) {
	return fetchJSON('https://nosuite.ngwy.fr/account-info', {
		method: 'POST',
		body: { token: token || localStorage.getItem('token') }
	});
}

// ---- SOCKET ----

const SOCKET = io('https://nosuite.ngwy.fr');
const CLIENT_ID = Date.now().toString(36).slice(-2); // Just for broadcast self identification

// ---- STORAGE ----

class PATH {
	static join(...paths) {
		return paths.join('/').replace(/\/+/g, '/');
	}

	static basename(path) {
		return path?.split('/').pop() || '';
	}

	static dirname(path) {
		return path?.split('/').slice(0, -1).join('/') || '/';
	}

	static trim(path) {
		return path.replace(/^\//, '').replace(/\/$/, '') || '/';
	}
}

class STORAGE {
	// Send commands to storage service
	static sendCmds(cmds) {
		return new Promise((resolve, reject) => {
			cmds = cmds.map(cmd => ({
				// Command
				...cmd,

				// Auth
				token: localStorage.getItem('token'),
				app: location.host,
				client_id: CLIENT_ID
			}));

			// Send commands
			SOCKET.emit('storage', cmds, responses => {
				// Error handling
				if (responses.error) return reject(responses.error);
				const errors = responses.filter(r => r.error);
				if (errors.length) return reject(errors[0].error);

				resolve(responses);
			});
		});
	}

	// Listen for remote file changes
	static onChange(callback) {
		SOCKET.on('file-change', cmd => {
			cmd.by_self = cmd.client_id === CLIENT_ID;
			delete cmd.id;
			callback(cmd);
		});
	}

	// List files and directories in a path
	static async ls(path) {
		const responses = await STORAGE.sendCmds([{ type: 'ls', path }]);
		return responses[0];
	}

	// List files and directories recursively in a path
	static async lsR(path) {
		const responses = await STORAGE.sendCmds([{ type: 'ls-r', path }]);
		return responses[0];
	}

	// Read file content
	static async read(path) {
		const responses = await STORAGE.sendCmds([{ type: 'read', path }]);
		return responses[0].content;
	}

	// Write content to a file
	static async write(path, content) {
		const responses = await STORAGE.sendCmds([{ type: 'write', path, content }]);
		return responses[0];
	}

	// Write a chunk of data_url to a file
	static async writeChunk(path, chunk, final = false) {
		const responses = await STORAGE.sendCmds([{ type: 'write-chunk', path, chunk, final }]);
		return responses[0];
	}

	// Upload an url_data
	static async uploadUrlData(url_data, path, progress_callback) {
		const chunk_size = 1024 * 950;
		let offset = 0;

		// Write chunk by chunk
		while (offset < url_data.length) {
			progress_callback(offset / url_data.length);
			const chunk = url_data.slice(offset, offset + chunk_size);
			await STORAGE.writeChunk(path, chunk, offset + chunk_size >= url_data.length);
			offset += chunk_size;
		}

		progress_callback(1);
	}

	// Create a directory
	static async mkdir(path) {
		const responses = await STORAGE.sendCmds([{ type: 'mkdir', path }]);
		return responses[0];
	}

	// Remove a file or directory
	static async rm(path) {
		const responses = await STORAGE.sendCmds([{ type: 'rm', path }]);
		return responses[0];
	}

	// Read the data of a file input
	static fileData(file) {
		return new Promise(resolve => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result);
			reader.readAsDataURL(file);
		});
	}

	// Apply a callback to each file in storage
	static async traverse(callback) {
		let current_paths = ['.'];

		// While we have new paths to explore
		while (current_paths.length) {
			const new_paths = [];

			// List all paths in parallel
			const cmds = current_paths.map(path => ({ type: 'ls', path }));
			const responses = await STORAGE.sendCmds(cmds);

			// For each element in each path
			for (const response of responses) {
				for (const elem of response) {
					if (elem.is_directory) new_paths.push(elem.path);
					else await callback(elem);
				}
			}

			// Update the current paths
			current_paths = new_paths;
		}
	}
}

// ---- DATE AND TIME ----

class DATE {
	// Describe a date in French
	static toFrench(date_ms, full = false) {
		const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
		const full_days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
		const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

		const today = new Date();

		const date = new Date(+date_ms);
		const day = days[date.getDay()];
		const full_day = full_days[date.getDay()];
		const month = months[date.getMonth()];
		const year = date.getFullYear();
		const hours = date.getHours().toString().padStart(2, '0');
		const minutes = date.getMinutes().toString().padStart(2, '0');

		const changeDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

		if (date.toDateString() === today.toDateString()) return `Aujourd'hui à ${hours}h${minutes}`;
		if (date.toDateString() === changeDays(today, -1).toDateString()) return `Hier à ${hours}h${minutes}`;
		if (date.toDateString() === changeDays(today, 1).toDateString()) return `Demain à ${hours}h${minutes}`;
		if (date > changeDays(today, -7)) return `${full_day}${full ? ` à ${hours}h${minutes}` : ''}`;
		if (date < changeDays(today, 7)) return `${full_day}${full ? ` à ${hours}h${minutes}` : ''}`;
		if (year !== new Date().getFullYear()) return `${day} ${date.getDate()} ${month} ${year}${full ? ` à ${hours}h${minutes}` : ''}`;

		return `${day} ${date.getDate()} ${month}${full ? ` à ${hours}h${minutes}` : ''}`;
	}

	// Describe a date in English
	static toEnglish(date_ms, full = false) {
		const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		const full_days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
		const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

		const today = new Date();

		const date = new Date(+date_ms);
		const day = days[date.getDay()];
		const full_day = full_days[date.getDay()];
		const month = months[date.getMonth()];
		const year = date.getFullYear();
		const hours = date.getHours().toString().padStart(2, '0');
		const minutes = date.getMinutes().toString().padStart(2, '0');

		const changeDays = (date, days) => new Date(new Date(date).setDate(date.getDate() + days));

		if (date.toDateString() === today.toDateString()) return `Today at ${hours}:${minutes}`;
		if (date.toDateString() === changeDays(today, -1).toDateString()) return `Yesterday at ${hours}:${minutes}`;
		if (date.toDateString() === changeDays(today, 1).toDateString()) return `Tomorrow at ${hours}:${minutes}`;
		if (changeDays(today, -7) < date && date < changeDays(today, 7)) return `${full_day}${full ? ` at ${hours}:${minutes}` : ''}`;
		if (year !== new Date().getFullYear()) return `${day} ${month} ${date.getDate()} ${year}${full ? ` at ${hours}:${minutes}` : ''}`;

		return `${day} ${month} ${date.getDate()}${full ? ` at ${hours}:${minutes}` : ''}`;
	}

	// Parse a date from a string
	static async parseNLP(date_str) {
		// We use the chrono library, server side (using SOCKET)
		return new Promise((resolve, reject) => {
			SOCKET.emit('date-nlp', date_str, response => {
				if (response?.error) return reject(response.error);
				resolve(response);
			});
		});
	}
}

// ---- AI GENERATION ----

class AI {
	// Generate text using the AI
	static generate(opt, intermediate_callback) {
		return new Promise(async (resolve, reject) => {
			// Create a unique id for the generation
			const id = `ai-${Date.now().toString(36)}`;

			// The result
			let result = '';

			// Listen for the generation chunks
			SOCKET.on(id, chunk => {
				// Error handling
				if (chunk.error) {
					SOCKET.off(id);
					app.toast('red', 8000, 'Error while generating text.', () => alert(chunk.error));
					return reject(chunk.error);
				}

				// If the chunk is final
				if (chunk.final) {
					SOCKET.off(id);
					console.log(result);
					return resolve(result);
				}

				// Append the chunk to the result
				result += chunk;

				// Call the intermediate callback
				intermediate_callback?.(chunk, result);
			});

			// Send the generation request
			SOCKET.emit('generate-text', { ...opt, id });
		});
	}
}
