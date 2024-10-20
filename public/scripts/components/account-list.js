class AccountList extends CustomElement {
	get accounts() {
		const str = localStorage.getItem('accounts') || '';
		return str.split(',').filter(Boolean);
	}

	set accounts(accounts) {
		localStorage.setItem('accounts', accounts.join(','));
	}

	constructor() {
		super();

		this.whenReady(() => this.selectAccount());
	}

	async getAppToken(account_token) {
		const json = await fetchJSON(`/auth/${origin_app}`, {
			method: 'POST',
			body: { token: account_token }
		});

		if (json.error) {
			alert("Erreur lors de l'authentification : " + json.error);
			return null;
		}

		return json.token;
	}

	selectAccount() {
		this.innerHTML = html`
			<form>
				<div id="add-account">
					<span class="icon">add</span>
					<span>Ajouter un compte</span>
				</div>
			</form>
		`;

		const add_btn = this.$('#add-account');

		for (const account_token of this.accounts) {
			const account = render(html`<account-option token=${account_token} />`);
			add_btn.before(account);

			// Auth user in app on click
			account.onclick = async () => {
				const app_token = await this.getAppToken(account_token);
				if (!app_token) return;
				opener?.postMessage(app_token, '*');
				close();
			};

			// Remove account on right click
			account.oncontextmenu = e => {
				e.preventDefault();
				if (!confirm(`Voulez-vous vraiment supprimer le compte ${account.name} ?`)) return;
				this.accounts = this.accounts.filter(token => token !== account_token);
				account.remove();
			};
		}

		add_btn.onclick = e => this.addAccount();
	}

	emailForm() {
		return new Promise(resolve => {
			this.innerHTML = html`
				<form>
					<input type="email" placeholder="Email" name="email" required />
					<button type="submit">Suivant</button>
				</form>
			`;

			const form = this.$('form');

			form.onsubmit = async e => {
				e.preventDefault();
				form.onsubmit = null;
				form.$('input').disabled = true;
				form.$('button').disabled = true;
				resolve(form.email.value);
			};

			this.$('input').focus();
		});
	}

	async addAccount() {
		const email = await this.emailForm();

		// Send email and get info from server
		const json = await fetchJSON('/email', {
			method: 'POST',
			body: { email }
		});

		// Refuse if not in beta access list
		if (json.error === 'refuse') {
			alert('Vous devez être invité pour accéder aux applications Nosuite.');
			return this.addAccount();
		}

		// If error, alert
		if (json.error) {
			alert("Erreur lors de la vérification de l'email : " + json.error);
			return this.addAccount();
		}

		const token = json.action === 'sign in' ? await this.signIn(email) : await this.signUp(email);

		// Add token to accounts
		this.accounts = [...this.accounts, token];

		// Select account
		this.selectAccount();
	}

	signInForm(email) {
		return new Promise(resolve => {
			this.innerHTML = html`
				<form>
					<input type="email" placeholder="Email" name="email" disabled />
					<input type="password" placeholder="Mot de passe" name="password" required />
					<button type="submit">Connexion</button>
				</form>
			`;

			const form = this.$('form');

			form.email.value = email;

			form.onsubmit = async e => {
				e.preventDefault();
				form.onsubmit = null;
				form.password.disabled = true;
				form.$('button').disabled = true;
				resolve(form.password.value);
			};

			this.$('input').focus();
		});
	}

	async signIn(email) {
		const password = await this.signInForm(email);

		// Send email and password to server
		const json = await fetchJSON('/auth', {
			method: 'POST',
			body: { email, password, app: origin_app }
		});

		// If error, alert
		if (json.error) {
			alert('Erreur lors de la connexion : ' + json.error);
			return this.signIn(email);
		}

		// Return token
		return json.token;
	}

	signUpForm(email) {
		return new Promise(resolve => {
			this.innerHTML = html`
				<form>
					<input type="email" placeholder="Email" name="email" disabled />
					<input type="text" placeholder="Nom du compte" name="name" required />
					<input type="password" placeholder="Mot de passe" name="password" required />
					<input type="password" placeholder="Confirmer le mot de passe" name="confirm" required />
					<button type="submit">Inscription</button>
				</form>
			`;

			const form = this.$('form');

			form.email.value = email;

			form.onsubmit = async e => {
				e.preventDefault();

				if (form.password.value !== form.confirm.value) {
					alert('Les mots de passe ne correspondent pas');
					form.confirm.value = '';
					form.confirm.focus();
					return;
				}

				form.onsubmit = null;
				form.password.disabled = true;
				form.confirm.disabled = true;
				form.$('button').disabled = true;
				resolve({ name: form.name.value, password: form.password.value });
			};

			this.$('input').focus();
		});
	}

	async signUp(email) {
		const { name, password } = await this.signUpForm(email);

		// Send email and password to server
		const json = await fetchJSON('/auth', {
			method: 'POST',
			body: { email, password, name, app: origin_app }
		});

		// If error, alert
		if (json.error) {
			alert("Erreur lors de l'inscription : " + json.error);
			return this.signUp(email);
		}

		// Return token
		return json.token;
	}
}

defineComponent(html`<account-list />`);

class AccountOption extends CustomElement {
	constructor() {
		super();

		this.whenReady(async () => {
			this.innerHTML = html`
				<div class="account-circle"></div>
				<div class="account-info">
					<span class="account-name">Chargement...</span>
					<span class="account-email">...</span>
				</div>
			`;

			const info = await getAccountInfo(this.token);

			if (info.error) {
				const account_list = this.closest('account-list');
				account_list.accounts = account_list.accounts.filter(token => token !== this.token);
				return this.remove();
			}

			this.email = info.email;
			this.name = info.name;

			const initials = this.name
				.split(' ')
				.slice(0, 2)
				.map(word => word[0])
				.join('')
				.toUpperCase();

			this.innerHTML = html`
				<div class="account-circle">${initials}</div>
				<div class="account-info">
					<span class="account-name">${this.name}</span>
					<span class="account-email">${this.email}</span>
				</div>
			`;
		});
	}
}

defineComponent(html`<account-option token />`);
