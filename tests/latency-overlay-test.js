const Foglet = require('foglet-core').Foglet

describe('Latency overlay.', () => {
  it('Latency overlay should be constructed correctly', () => {
    const Overlay = require('../src/latency-overlay.js');
    const latencyOverlay = new Overlay('test');
		//assert.equal(latencyOverlay.options, 'test');
  })
})
