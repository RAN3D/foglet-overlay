'use strict';

class A extends Map {
	constructor () {
		super();
	}
}

module.exports = {
	latencyVivaldiOverlay: require('./src/latency-vivaldi-overlay.js'),
	foglet: require('foglet-core'),
	MyMap: A
}
