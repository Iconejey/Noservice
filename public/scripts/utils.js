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
	text = text.replaceAll(/<([\w-]+)[^>]*\/>/g, (match, tag) => {
		// If tag contains a dash, it's a custom element
		if (tag.includes('-')) return match.replace('/>', `></${tag}>`);

		// Else it's a native element, ignore
		return match;
	});

	// Return text
	return text;
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

const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

function dateToFrench(date_ms) {
	const today = new Date();

	const date = new Date(+date_ms);
	const day = days[date.getDay()];
	const month = months[date.getMonth()];
	const year = date.getFullYear();
	const hours = date.getHours().toString().padStart(2, '0');
	const minutes = date.getMinutes().toString().padStart(2, '0');

	if (date.toDateString() === today.toDateString()) return `Aujourd'hui à ${hours}h${minutes}`;
	if (date.toDateString() === new Date(today.setDate(today.getDate() - 1)).toDateString()) return `Hier à ${hours}h${minutes}`;
	if (year !== new Date().getFullYear()) return `${day} ${date.getDate()} ${month} ${year}`;

	return `${day} ${date.getDate()} ${month}`;
}

async function fetchJSON(url, options) {
	options = options || {};

	options.headers = {
		...options.headers,
		'Content-Type': 'application/json',
		Authorization: `Bearer ${localStorage.getItem('token')}`
	};

	options.body &&= JSON.stringify(options.body);

	const res = await fetch(url, options);

	if (location.host !== 'nosuite.ngwy.fr' && res.status === 401) {
		localStorage.removeItem('token');
		alert('Votre session a expiré, veuillez vous reconnecter.');
		return location.reload();
	}

	try {
		if (!res.ok) return { error: res.statusText };

		const json = await res.json();
		if (json?.error) console.error(json.error);
		return json;
	} catch (err) {
		console.error(err);
		return { error: 'Invalid JSON' };
	}
}

function delay(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- AUTHENTICATION ----

function openAuthWindow() {
	return new Promise(resolve => {
		// Handle message from auth service
		function message_handler(e) {
			if (e.origin !== 'https://nosuite.ngwy.fr') return;
			resolve(e.data);
		}

		// Listen for message from auth service
		addEventListener('message', message_handler, { once: true });

		// Open auth window
		open(`https://nosuite.ngwy.fr/auth?app=${location.host}`, 'auth', 'width=400,height=500');
	});
}

function userSignedIn() {
	return !!localStorage.getItem('token');
}

async function authenticate(force = false) {
	// Nosuite auth service
	if (force || !userSignedIn()) {
		const popup_token = await openAuthWindow();
		if (popup_token) localStorage.setItem('token', popup_token);
	}

	return userSignedIn();
}

function signOut() {
	localStorage.removeItem('token');
	location.reload();
}

function getAccountInfo(token) {
	return fetchJSON('https://nosuite.ngwy.fr/account-info', {
		method: 'POST',
		body: { token: token || localStorage.getItem('token') }
	});
}

// ---- STORAGE ----

function joinPath(...paths) {
	return paths.join('/').replace(/\/+/g, '/');
}

class STORAGE {
	static ls(path) {
		const route = joinPath('ls', path);
		return fetchJSON(`https://nosuite.ngwy.fr/${route}`);
	}

	static async read(path) {
		const route = joinPath('read', path);
		const { content } = await fetchJSON(`https://nosuite.ngwy.fr/${route}`);
		return content;
	}

	static write(path, content) {
		const route = joinPath('write', path);
		return fetchJSON(`https://nosuite.ngwy.fr/${route}`, { method: 'POST', body: { content } });
	}

	static mkdir(path) {
		const route = joinPath('mkdir', path);
		return fetchJSON(`https://nosuite.ngwy.fr/${route}`, { method: 'POST' });
	}

	static rm(path) {
		const route = joinPath('rm', path);
		return fetchJSON(`https://nosuite.ngwy.fr/${route}`, { method: 'DELETE' });
	}
}
