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
    this.options.pingDelta = this.options.pingDelta || 10 * 1000;
    this.options.timeoutDescriptor = this.options.timeoutDescriptor || 30 * 1000;
    this.fakeRtt = this.options.fakeRtt || {
      latencies: [[]],
      revertedName: new Map(),
      compute: (myInViewId, peerInViewId, latencies, revertedName) => Math.random() * 10 + 100
    };

    // internal communications
    this.communication = new Communication(this, this.options.procotol+'-internal');
    this.communicationParent = new Communication(this.options.manager._rps.network, this.options.procotol+'-parent-internal');
    this.communication.onUnicast((id, message) => {
      // debug('tman: ', id, message);
      if(message.type && message.type === 'ping-descriptor'){
        message.type = 'pong-descriptor';
        message.descriptor = this.descriptor;
        try {
          if(this.getNeighbours(Infinity).includes(id)){
            this.communication.sendUnicast(id, message);
          }
        } catch (e) {
          console.log('pong tman:', e);
        }
      } else if (message.type && message.type === 'pong-descriptor') {
        this.emit('pong-descriptor-'+message.id, message);
      }
    });
    this.communicationParent.onUnicast((id, message) => {
      if(message.type && message.type === 'ping-descriptor'){
        message.type = 'pong-descriptor';
        message.descriptor = this.descriptor;
        try {
          if(this.options.manager._rps.network.getNeighbours(Infinity).includes(id)){
            this.communicationParent.sendUnicast(id, message);
          } 
        } catch (e) {
          console.log('pong parent:', e);
        }
      } else if (message.type && message.type === 'pong-descriptor') {
        this.emit('pong-descriptor-'+message.id, message);
      }
    });
  }

	_startDescriptor () {
    this.intervalPing = setInterval(() => {
        // console.log('Neighbours: ', this.getNeighbours(), this._rps.cache);
        let neigh = this.getNeighbours();
        let parentNeigh = this.options.manager._rps.network.getNeighbours();
        neigh.forEach(peer => {
          this._pingUpdate(peer).then(() => {
            console.log('Updated our position from tman neighbours');
          }).catch(e => {
            console.log(e);
          });
        });
        parentNeigh.forEach(peer => {
          this._pingUpdateParent(peer).then(() => {
            console.log('Updated our position from parent neighbours');
          }).catch(e => {
            console.log(e);
          });
        });
    }, this.options.pingDelta);
    let viv = vivaldi.create();
    return { coordinates: viv };
  }

  _pingUpdate(peer) {
    return new Promise((resolve, reject) => {
      // compute the ping and get the remote descriptor
      this._ping(peer).then((result) => {
        // update the descriptor in the cache and the partial view if inside
        this._updateDescriptor(peer, result.descriptor);
        this._updateOurDescriptor(result.rtt, result.descriptor);
        resolve();
      }).catch(e => {
        console.log('ping: ', e);
        reject(e); //reject(e);
      });
    });
  }

  _pingUpdateParent(peer) {
    return new Promise((resolve, reject) => {
      // compute the ping and get the remote descriptor
      this._pingParent(peer).then((result) => {
        // update the descriptor in the cache and the partial view if inside
        this._updateDescriptor(peer, result.descriptor);
        this._updateOurDescriptor(result.rtt, result.descriptor);
        resolve();
      }).catch(e => {
        console.log('ping: ', e);
        reject(e); //reject(e);
      });
    });
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
				if(index < 0) reject('id not in our list of neighbours');
				const idMessage = uuid();
				let pingTime = (new Date()).getTime();
				// send a ping request
				try {
          this.communication.sendUnicast(id, {
            id: idMessage,
            type: 'ping-descriptor'
          })
				} catch (e) {
				  reject('ping'+e.stack);
				}
				this.once('pong-descriptor-'+idMessage, (msg) => {
					// listening for an incoming response of our ping
					// double check if message is a goood message,
					if(msg.id === idMessage) {
						let time = (new Date()).getTime() - pingTime;
            if(this.fakeRtt)
              resolve({ rtt: this.fakeRtt.compute(this.inviewId, id, this.fakeRtt.latencies, this.fakeRtt.revertedName), descriptor: msg.descriptor });
            else
              resolve({ rtt: time, descriptor: msg.descriptor });
					}
				});
			} catch (e) {
				reject(e);
			}
		});
	}

  /**
	 * Utility: Ping the specified id
	 * @param  {string} id id of the peer to ping
	 * @return {Promise} Return a promise with the specified {Time} representing the ping between {this} and the peer {id}
	 */
	_pingParent (id) {
		return new Promise((resolve, reject) => {
			try {
				let index = this.options.manager._rps.network.getNeighbours().indexOf(id);
				if(index < 0) reject('id not in our list of neighbours');
				const idMessage = uuid();
				let pingTime = (new Date()).getTime();
				// send a ping request
				try {
          this.communication.sendUnicast(id, {
            id: idMessage,
            type: 'ping-descriptor'
          })
				} catch (e) {
				  reject('ping'+e.stack);
				}
				this.once('pong-descriptor-'+idMessage, (msg) => {
					// listening for an incoming response of our ping
					// double check if message is a goood message,
					if(msg.id === idMessage) {
						let time = (new Date()).getTime() - pingTime;
            if(this.fakeRtt)
              resolve({ rtt: this.fakeRtt.compute(this.inviewId, id, this.fakeRtt.latencies, this.fakeRtt.revertedName), descriptor: msg.descriptor });
            else
              resolve({ rtt: time, descriptor: msg.descriptor });
					}
				});
			} catch (e) {
				reject(e);
			}
		});
	}

  /**
   * Update the descriptor for the id in the cache or in the partialview
   * @param  {string} id         id of the descriptor owner
   * @param  {object} descriptor Descriptor of the peer identified by its id
   * @return {void}
   */
  _updateDescriptor(id, descriptor) {
    if(!this._rps.cache.has(id)){
      this._rps.cache.add(id, descriptor);
    } else {
      this._rps.cache.set(id, descriptor);
    }
    if(this.rps.partialView.has(id)){
      this._rps.partialView.updateNeighbor(id, descriptor);
    }
  }

  _updateOurDescriptor(rtt, descriptor) {
    let res = false;
    try {
      // debug('descriptor before:', this.descriptor.coordinates._coordinates, this._rps.options.descriptor.coordinates._coordinates);
      const obj = descriptor.coordinates._coordinates;
      const remoteCoordinates = vivaldi.create(new vivaldi.HeightCoordinates(obj.x, obj.y, obj.h));
      res = vivaldi.update(rtt, this.descriptor.coordinates, remoteCoordinates);
      this._rps.options.descriptor = this.descriptor;
      // debug('descriptor after:', this.descriptor.coordinates._coordinates, this._rps.options.descriptor.coordinates._coordinates);  
    } catch (error) {
      console.log(error);
    }
    return res;
  }

  _descriptorTimeout () {
    return this.options.timeoutDescriptor;
  }

  _rankPeers (neighbours, descriptorA, descriptorB) {
    function createHeighFromDescriptor (desc) {
      return new vivaldi.VivaldiPosition(new vivaldi.HeightCoordinates(desc.coordinates._coordinates.x, desc.coordinates._coordinates.y, desc.coordinates._coordinates.h ));
    }
    function distance(a, b) {
      const m1 = Math.pow((b.x - a.x), 2);
      const m2 = Math.pow((b.y - a.y), 2);
      const m3 = Math.pow((b.h - a.h), 2);
      return Math.sqrt(m1+m2+m3);
    }
    // debug(this.inviewId, coordNeig, coordA, coordB);
    //const da = distance(new vivaldi.HeightCoordinates(neighbours.descriptor.coordinates._coordinates.x, neighbours.descriptor.coordinates._coordinates.y, neighbours.descriptor.coordinates._coordinates.h), new vivaldi.HeightCoordinates(descriptorA.coordinates._coordinates.x, descriptorA.coordinates._coordinates.y, descriptorA.coordinates._coordinates.h));
    //const db = distance(new vivaldi.HeightCoordinates(neighbours.descriptor.coordinates._coordinates.x, neighbours.descriptor.coordinates._coordinates.y, neighbours.descriptor.coordinates._coordinates.h), new vivaldi.HeightCoordinates(descriptorB.coordinates._coordinates.x, descriptorB.coordinates._coordinates.y, descriptorB.coordinates._coordinates.h));
    const da = vivaldi.distance(createHeighFromDescriptor(neighbours.descriptor), createHeighFromDescriptor(descriptorA));
    const db = vivaldi.distance(createHeighFromDescriptor(neighbours.descriptor), createHeighFromDescriptor(descriptorB));

    // debug(da, db, da < db);
    // debug('Rankpeers: me:', neighbours, neighbours.descriptor.coordinates._coordinates, descriptorA.coordinates._coordinates, descriptorB.coordinates._coordinates);
    if(isNaN(da) && isNaN(db)) return Infinity;
    if(isNaN(da)) return 1;
    if(isNaN(db)) return -1;
    if(da < db) return -1;
    if(da === db) return 0;
    return 1;
  }
	
}

module.exports = LatencyOverlay;
