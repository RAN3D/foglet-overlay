const TMan = require('foglet-core').abstract.tman;
const Communication = require('foglet-core').communication;
const vivaldi = require('vivaldi-coordinates');
const debug = require('debug')('overlay:latency')
const lmerge = require('lodash.merge');
const isEmpty = require('lodash.isempty');
const uuid = require('uuid/v4');
const Serialize = require('serialize-javascript');

const ExPeerNotFound = require('tman-wrtc/lib/exceptions/expeernotfound.js');
const Cache = require('./cacheRtt.js');

class LatencyOverlay extends TMan{
  constructor(manager, options){
    let opt = lmerge({
      vivaldi: {
        error: 50
      }
    }, options);
    super(manager, opt);
    // specific options
    this.partialViewSize = this.options.partialViewSize || 5;
    this.rps._partialViewSize = () => this.partialViewSize;
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
      message = this.deserialize(message);

      // debug('tman: ', id, message);
      if(message.type && message.type === 'ping-descriptor'){
        // update coordinates of the descriptor we just received
        let desc = this.rps.cache.has(message.owner) && this.rps.cache.get(message.owner);
        if(desc){
          desc.coordinates = message.coordinates;
          this._updateDescriptor(message.owner, desc);
        }
        message.type = 'pong-descriptor';
        message.descriptor = this.descriptor;
        try {
          if(this.getNeighbours(Infinity).includes(id)){
            this.communication.sendUnicast(id, this.serialize(message));
          }
        } catch (e) {
          console.log('pong tman:', e);
        }
      } else if (message.type && message.type === 'pong-descriptor') {
        this.emit('pong-descriptor-'+message.id, message);
      } else if (message.type && message.type === 'update-descriptor' && message.id && message.descriptor) {
        this._updatePositionFromRemoteCoordinates(message.id, message.descriptor);
      }
    });
    this.communicationParent.onUnicast((id, message) => {
      message = this.deserialize(message);

      if(message.type && message.type === 'ping-descriptor'){
        // update coordinates of the descriptor we just received
        let desc = this.rps.cache.has(message.owner) && this.rps.cache.get(message.owner);
        if(desc){
          desc.coordinates = message.coordinates;
          this._updateDescriptor(message.owner, desc);
        }

        message.type = 'pong-descriptor';
        message.descriptor = this.descriptor;
        try {
          if(this.options.manager._rps.network.getNeighbours(Infinity).includes(id)){
            this.communicationParent.sendUnicast(id, this.serialize(message));
          }
        } catch (e) {
          console.log('pong parent:', e);
        }
      } else if (message.type && message.type === 'pong-descriptor') {
        this.emit('pong-descriptor-'+message.id, message);
      } else if (message.type && message.type === 'update-descriptor' && message.id && message.descriptor) {
        this._updatePositionFromRemoteCoordinates(message.id, message.descriptor);
      }
    });

    // delete this.rps.partialView.oldest;
    // Object.defineProperty(this.rps.partialView, "oldest", {
    //   get: function () {
    //     if (this.size <= 0) { throw new ExPeerNotFound('getOldest'); };
    //     let elems = [];
    //     let mapIter = this.values();
    //     let val;
    //     while (val = mapIter.next().value) {
    //       elems.push(val);
    //     }
    //     let sortByAges = elems.slice().sort((a, b) => (a.ages - b.ages));
    //     // console.log('SortByAges;', sortByAges);
    //     let sortByRtt = sortByAges.slice().sort((a, b) => ( a.descriptor.latencies.cache[a.peer] - b.descriptor.latencies.cache[b.peer]));
    //     console.log('SortByRtt;', sortByRtt);
    //     const oldest = sortByRtt[sortByRtt.length-1].peer
    //     // const oldest = sortByAges[sortByAges.length-1].peer
    //     console.log('Oldest:', oldest);
    //     return oldest;
    //   }
    // });

    this.descriptor.peer = this.inviewId;

    // delete this.rps._getSample();
    // Object.defineProperty(this._rps, "_getSample", {
    //   value: function (neighbor) {
    //     // #1 create a flatten version of the partial view
    //     let flatten = [];
    //     // #A extract the partial view of tman
    //     this.partialView.forEach( (epv, peerId) => {
    //         epv.ages.forEach( (age) => {
    //             !isEmpty(epv.descriptor) && flatten.push(peerId);
    //         });
    //     });
    //     // #B add random peers from parent
    //     this.parent && this.parent.partialView.forEach( (ages, peerId) => {
    //         if (this.cache.has(peerId) && flatten.indexOf(peerId) < 0) {
    //             flatten.push(peerId);
    //         };
    //     });
    //     // #2 replace all peerId occurrences by ours
    //     flatten = flatten.map( (peerId) => {
    //         let d = {descriptor: this.options.descriptor};
    //         if (peerId === neighbor.peer){
    //             d.peer = this.getInviewId();
    //         } else {
    //             d.descriptor = (this.cache.has(peerId)&&this.cache.get(peerId))
    //                 || this.partialView.getDescriptor(peerId);
    //             d.peer = peerId;
    //         };
    //         return d;
    //     });
    //     // #3 process the size of the sample
    //     const sampleSize = this._sampleSize(flatten);
    //     // #4 rank according to PeerId
    //     flatten.sort( this.options.ranking(neighbor) );
    //     return flatten.slice(0, sampleSize);
    //   }
    // });
  }

  serialize(message) {
    return Serialize(message, {isJSON: true});
  }

  deserialize(message) {
    return eval('(' + message + ')');
  }

  _updatePositionFromRemoteCoordinates(id, descriptor) {
    this.descriptor.latencies.set(id, descriptor.latencies.cache[this.inviewId]);
    // this.descriptor.latencies.set(id, descriptor.latencies.cache[this.inviewId]);
    const rtt = this.descriptor.latencies.get(this.inviewId);
    if(rtt) this._updateOurDescriptor(id, descriptor, rtt);
  }

	_startDescriptor () {
    this.intervalPing = setInterval(() => {
        // console.log('Neighbours: ', this.getNeighbours(), this.rps.cache);
        let neigh = this.getNeighbours();
        let parentNeigh = this.options.manager._rps.network.getNeighbours();
        neigh.forEach(peer => {
          //f(!this.descriptor.latencies.get(peer)) {
            this._pingUpdate(peer).then(() => {
              // console.log('Updated our position from tman neighbours');
              // send our descriptor to all neighbours for update
              this.sendLocalDescriptor();
            }).catch(e => {
              console.log(e);
            });
          //}
        });
        parentNeigh.forEach(peer => {
          //if(!this.descriptor.latencies.get(peer)) {
            this._pingUpdateParent(peer).then(() => {
              // console.log('Updated our position from parent neighbours');
              // send our descriptor to all parent neighbours for update
              this.sendLocalDescriptorParent();
            }).catch(e => {
              console.log(e);
            });
          //}
        });
    }, this.options.pingDelta);
    let viv = vivaldi.create(this.options.vivaldi.error);
    this.coordinates = viv;
    return { coordinates: viv.toFloatArray(), latencies: new Cache(this.options.timeout) };
  }

  sendLocalDescriptor () {
    let desc = this.descriptor;
    this.getNeighbours().forEach(peer => {
      this.communication.sendUnicast(peer, this.serialize({
        id: this.inviewId,
        type: 'update-descriptor',
        descriptor: desc
      }));
    });
  }

  sendLocalDescriptorParent () {
    let desc = this.descriptor;
    this.options.manager._rps.network.getNeighbours().forEach(peer => {
      this.communicationParent.sendUnicast(peer, this.serialize({
        id: this.inviewId,
        type: 'update-descriptor',
        descriptor: desc
      }));
    });
  }

  _pingUpdate(peer) {
    return new Promise((resolve, reject) => {
      // compute the ping and get the remote descriptor
      this._ping(peer).then((result) => {
        this.descriptor.latencies.set(peer, result.rtt);
        // update the descriptor in the cache and the partial view if inside
        this._updateDescriptor(peer, result.descriptor);
        this._updateOurDescriptor(peer, result.descriptor, result.rtt);
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
        this.descriptor.latencies.set(peer, result.rtt);
        // update the descriptor in the cache and the partial view if inside
        this._updateDescriptor(peer, result.descriptor);
        this._updateOurDescriptor(peer, result.descriptor, result.rtt);
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
        let index = this.getNeighbours(Infinity).indexOf(id);
				if(index < 0) reject('id not in our list of neighbours');
				const idMessage = uuid();
				let pingTime = (new Date()).getTime();
				// send a ping request
				try {
          this.communication.sendUnicast(id, this.serialize({
            id: idMessage,
            type: 'ping-descriptor',
            owner: this.inviewId,
            coordinates: this.descriptor.coordinates
          }));
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
				let index = this.options.manager._rps.network.getNeighbours(Infinity).indexOf(id);
				if(index < 0) reject('id not in our list of neighbours');
				const idMessage = uuid();
				let pingTime = (new Date()).getTime();
				// send a ping request
				try {
          this.communication.sendUnicast(id, this.serialize({
            id: idMessage,
            type: 'ping-descriptor',
            owner: this.inviewId,
            coordinates: this.descriptor.coordinates
          }));
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
  _updateDescriptor(id, descriptor, rtt) {
    if(!this.rps.cache.has(id)){
      this.rps.cache.add(id, descriptor);
    } else {
      this.rps.cache.set(id, descriptor);
    }
    if(this.rps.partialView.has(id)){
      this.rps.partialView.updateNeighbor(id, descriptor);
    }
  }

  _updateCoordinates(){
    const cache = this.rps.cache;
    cache.forEach(c => {
      let correspondigRtt = this.descriptor.latencies.get(c.peer);
      if(correspondigRtt){
        vivaldi.update(correspondigRtt, this.coordinates, this._createHeighFromDescriptor(c));
      }
    })
    this.descriptor.coordinates = this.coordinates.toFloatArray();
  }

  _updateOurDescriptor(id, descriptor, rtt) {
    let res = false;
    try {
      // update our position from the new rtt
      const remoteCoordinates = this._createHeighFromDescriptor(descriptor);
      res = vivaldi.update(rtt, this.coordinates, remoteCoordinates);
      // re compute on all previous coordinates
      this._updateCoordinates();
      this.rps.options.descriptor = this.descriptor;

    } catch (error) {
      console.log(error);
    }
    return res;
  }

  _descriptorTimeout () {
    return this.options.timeoutDescriptor;
  }

  _createHeighFromDescriptor (desc) {
    //
    return vivaldi.VivaldiPosition.fromFloatArray(desc.coordinates);
    // return new vivaldi.VivaldiPosition(new vivaldi.HeightCoordinates(desc.coordinates._coordinates.x, desc.coordinates._coordinates.y, desc.coordinates._coordinates.h ));
  }

  _vivaldiDistance (desc1, desc2) {
    return vivaldi.distance(this._createHeighFromDescriptor(desc1), this._createHeighFromDescriptor(desc2));
  }

  _euclideanDistance (descA, descB) {
    let a = descA.coordinates._coordinates, b = descB.coordinates._coordinates;
    const m1 = Math.pow((b.x - a.x), 2);
    const m2 = Math.pow((b.y - a.y), 2);
    const m3 = Math.pow((b.h - a.h), 2);
    return Math.sqrt(m1+m2+m3);
  }

  _rankPeers (neighbours, descriptorA, descriptorB) {
    const da = this._vivaldiDistance(neighbours.descriptor, descriptorA);
    const db = this._vivaldiDistance(neighbours.descriptor, descriptorB);
    if(isNaN(da) && isNaN(db)) return -1;
    if(isNaN(da)) return 1;
    if(isNaN(db)) return -1;
    return da - db;
  }

}

module.exports = LatencyOverlay;
