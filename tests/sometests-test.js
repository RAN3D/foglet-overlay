const Overlays = require('../foglet-overlay.js');

describe('Require all overlay.', () => {
  it('Latency overlay should be required correclty', () => {
    let latencyOverlay = new Overlays.latencyOverlay('test');
		assert.equal(latencyOverlay.options, 'test');
  })
})
