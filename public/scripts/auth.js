// Get the origin app name from search params
const url_params = new URLSearchParams(location.search);
const origin_app = url_params.get('app');

onload = () => {
	$('#origin-app').innerText = origin_app;
};
