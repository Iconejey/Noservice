(async () => {
	const { Octokit } = await import('@octokit/rest');

	// Acces token using https://github.com/settings/tokens/new?scopes=repo
	const octokit = new Octokit({ auth: 'TOKEN' });

	async function ls(path) {
		// List folders in material-design-icons repository
		const response = await octokit.repos.getContent({
			owner: 'google',
			repo: 'material-design-icons',
			path
		});

		// Return folder names
		return response.data.filter(file => file.type === 'dir').map(folder => folder.name);
	}

	const icon_cat = await ls('src');
	const icon_names = [];

	for (const cat of icon_cat) {
		icon_names.push(...(await ls(`src/${cat}`)));
	}

	// Write icon names to file
	fs.writeFileSync('icons.json', JSON.stringify(icon_names));
})();
