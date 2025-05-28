// Get the origin app name from search params
const url_params = new URLSearchParams(location.search);
const origin_app = url_params.get('app') || 'account.nosuite.fr';

// Get or set device ID
const device_id = localStorage.getItem('device_id') || Math.random().toString(36).slice(4).toUpperCase();
localStorage.setItem('device_id', device_id);

onload = () => {
	$('#origin-app').innerText = origin_app;
	$('#device-id').innerText = device_id;
};
