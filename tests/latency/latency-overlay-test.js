const Foglet = require('foglet-core').Foglet

describe('Latency overlay.', () => {
  it('Latency overlay should be constructed correctly', () => {
    const Overlay = require('../../src/latency-overlay.js');
    let fog = new Foglet({
      overlays: [
        {
          name: 'latency',
          class: Overlay,
          options: {
            protocol: 'foglet-overlay-latencies', // foglet running on the protocol foglet-example, defined for spray-wrtc
            signaling: {
              address: 'https://signaling.herokuapp.com/',
              // signalingAdress: 'https://signaling.herokuapp.com/', // address of the signaling server
              room: 'best-room-for-foglet-overlay-latency' // room to join
            }
          }
        }
      ]
    })
    assert.notEqual(fog, undefined);
  })
})
