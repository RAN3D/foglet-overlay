const TMan = require('foglet-core').abstract.tman;
const Communication = require('foglet-core').communication;
const vivaldi = require('vivaldi-coordinates');
const debug = require('debug')('overlay:latency')
const lmerge = require('lodash.merge');
const uuid = require('uuid/v4');


class LatencyOverlay extends TMan{
  constructor(...args){
    super(...args);

    // specific options
    this.partialViewSize = this.options.partialViewSize || 5;
    this._rps._partialViewSize = () => this.partialViewSize;
    this.fakeRtt = this.options.fakeRtt || {
      latencies: [[]],
      revertedName: new Map(),
      compute: (myInViewId, peerInViewId, latencies, revertedName) => Math.random() * 10 + 100
    };

    // internal communications
    this.communication = new Communication(this, this.options.procotol+'-internal');
    this.communication.onUnicast((id, message) => {
      if(message.type && message.type === 'ping'){
        message.type = 'pong';
        this.communication.sendUnicast(id, message);
      } else if (message.type && message.type === 'pong') {
        this.emit('pong-'+message.id, message);
      } else if(message.type && message.type === 'update-descriptor' && message.id && message.descriptor) {
        this._updateDescriptor(message.id, message.descriptor);
      }
    });
  }

	_startDescriptor () {
    this.intervalPing = setInterval(() => {
        // console.log('Neighbours: ', this.getNeighbours(), this._rps.cache);
        this.getNeighbours().forEach(peer => {
          if(this._rps.cache.has(peer)) {
            const obj = this._rps.cache.get(peer).coordinates._coordinates;
            console.log('obj:', obj)
            const remoteCoordinates = vivaldi.create(new vivaldi.HeightCoordinates(obj.x, obj.y, obj.h));

            this._ping(peer).then((rtt) => {
              vivaldi.update(rtt, this.descriptor.coordinates, remoteCoordinates);
              const sent = {
                type: 'update-descriptor',
                id: this.inviewId,
                descriptor: this.descriptor
              };
              console.log('sent: ', sent);
              this.communication.sendUnicast(peer, sent);
            }).catch(e => {
              console.log(e);
            });
          }
        });
    }, this._descriptorTimeout());
    let viv = vivaldi.create();
    return { coordinates: viv };
  }

  _updateDescriptor(id, descriptor) {
    // debug('Descriptor: updated', id, descriptor);
    const cache = this._rps.cache;
    if(!cache.has(id)){
      cache.add(id, descriptor);
    } else {
      cache.set(id, descriptor);
    }
  }

  _descriptorTimeout () {
    return 10 * 1000;
  }

  _rankPeers (neighbours, descriptorA, descriptorB) {
    function distance(a, b) {
      console.log(a, b);
      const m1 = Math.pow((b.x - a.x), 2);
      const m2 = Math.pow((b.y - a.y), 2);
      const m3 = Math.pow((b.h - a.h), 2);
      console.log(m1, m2, m3)
      return Math.sqrt(m1+m2+m3);
    }
    // console.log(descriptorA, descriptorB)
    let coordA = vivaldi.create(new vivaldi.HeightCoordinates(descriptorA.coordinates._coordinates.x, descriptorA.coordinates._coordinates.y, descriptorA.coordinates._coordinates.h));
    let coordNeig = vivaldi.create(new vivaldi.HeightCoordinates(neighbours.descriptor.coordinates._coordinates.x, neighbours.descriptor.coordinates._coordinates.y, neighbours.descriptor.coordinates._coordinates.h));
    let coordB = vivaldi.create(new vivaldi.HeightCoordinates(descriptorB.coordinates._coordinates.x, descriptorB.coordinates._coordinates.y, descriptorB.coordinates._coordinates.h));
    // debug(this.inviewId, coordNeig, coordA, coordB);
    const da = distance(new vivaldi.HeightCoordinates(neighbours.descriptor.coordinates._coordinates.x, neighbours.descriptor.coordinates._coordinates.y, neighbours.descriptor.coordinates._coordinates.h), new vivaldi.HeightCoordinates(descriptorA.coordinates._coordinates.x, descriptorA.coordinates._coordinates.y, descriptorA.coordinates._coordinates.h));
    const db = distance(new vivaldi.HeightCoordinates(neighbours.descriptor.coordinates._coordinates.x, neighbours.descriptor.coordinates._coordinates.y, neighbours.descriptor.coordinates._coordinates.h), new vivaldi.HeightCoordinates(descriptorB.coordinates._coordinates.x, descriptorB.coordinates._coordinates.y, descriptorB.coordinates._coordinates.h));
    // debug(da, db);
    // debug('Rankpeers: me:', neighbours, neighbours.descriptor.coordinates._coordinates, descriptorA.coordinates._coordinates, descriptorB.coordinates._coordinates);
    if(isNaN(da) && isNaN(db)) return Infinity;
    if(isNaN(da)) return -1;
    if(isNaN(db)) return 1;
    if(da < db) return -1;
    if(da === db) return 0;
    return 1;
  }
		/**
	 * Utility: Ping the specified id
	 * @param  {string} id id of the peer to ping
	 * @return {Promise} Return a promise with the specified {Time} representing the ping between {this} and the peer {id}
	 */
	_ping (id) {
		return new Promise((resolve, reject) => {
			try {
				let index = this.getNeighbours().indexOf(id);
				if(index === -1) reject('id not in our list of neighbours');
				const idMessage = uuid();
				let pingTime = (new Date()).getTime();
				// send a ping request
				this.communication.sendUnicast(id, {
					id: idMessage,
					type: 'ping'
				}).catch(error => {
					reject(error);
				});
				this.once('pong-'+idMessage, (msg) => {
					// listening for an incoming response of our ping
					// double check if message is a goood message,
					if(msg.id === idMessage) {
						let time = (new Date()).getTime() - pingTime;
            if(this.fakeRtt)
              resolve(this.fakeRtt.compute(this.inviewId, id, this.fakeRtt.latencies, this.fakeRtt.revertedName));
            else
              resolve(time);
					}
				});
			} catch (e) {
				reject(e);
			}
		});
	}
}

module.exports = LatencyOverlay;
