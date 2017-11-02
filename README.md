# foglet-overlay

This is a package for all Overlays built with our interface of tman-wrtc (see https://github.com/ran3d/foglet-core)

## Usage to use exemples
```bash
// uncomment foglet-core part  in foglet-overlays.js
npm run build // build the bundle
npm start // run the signaling server
// open  tests/**/index.html
```

## Vivaldi Overlay for a T-Man based on latencies between peers

```js
// in node
const Overlays = require('foglet-overlay');
const OverlayLatencyClass = Overlays.latencyVivaldiOverlay;
```

Or by including the bundle into a html page
```js
console.log(overlay)
const OverlayLatency = overlay.latencyVivaldiOverlay;

const foglet = new Foglet({
  ...
  overlays:[
    {
      name: '<name>',
      class: OverlayLatencyClass,
      options: {
        vivaldi: {
          error: 50 // default 50
        },
        partialViewSize: 5, // default 5
        delta: 10 * 1000, // default: 10000, shuffling interval
        pingDelta: 5 * 1000, // default: 5000, ping interval
        timeout: 30 * 1000, // default: 30000, timeout of the cache and foglets
        timeoutDescriptor: 30 * 1000, // default: 30000, timeout of each descriptor sent
        fakeRtt: { // test purposes only
          latencies: [[]], // matrix of latencies, each column/row for a user id
          revertedName: new Map(), // Map of foglet Id mapped to their user id
          /**
           * [compute description]
           * @param  {string} myInViewId   [description]
           * @param  {string} peerInViewId [description]
           * @param  {array<array>} latencies    [description]
           * @param  {Map} revertedName [description]
           * @return {number}              Return the latency between to user defined by their InViewId (default: <uuid>-I)
           */
          compute: (myInViewId, peerInViewId, latencies, revertedName) => Math.random() * 10 + 100
        },
        protocol: "latency-protocol-overlay",
        signaling: {
          address: "http://localhost:3000",
          room: "latency-protocol-overlay-room"
        }
      }
    }
  ]
})
```
