const TMan = require('foglet-core').abstract.tman;
const Communication = require('foglet-core').communication;
const vivaldi = require('vivaldi-coordinates');
const debug = require('debug')('overlay:latency')
const lmerge = require('lodash.merge');
const isEmpty = require('lodash.isempty');
const uuid = require('uuid/v4');
const Serialize = require('serialize-javascript');

const ExPeerNotFound = require('tman-wrtc/lib/exceptions/expeernotfound.js');
const MRequire = require('tman-wrtc/lib/messages/mrequire.js');
const MSuggest = require('tman-wrtc/lib/messages/msuggest.js');
const Cache = require('./latencies-cache.js');

/**
 * This class is an Implementation of a T-Man Overlay based on Latency using Vivaldi as NCS.
 * We just improve it by adjusting/, affining our ranking according to real RTT on the last step of T-Man rank (see _keep method)
 */
class LatencyOverlay extends TMan{
  /**
   * Construcotr
   * @param  {NetworkManager} manager foglet-core Network Manager
   * @param  {Object} options Options
   * @param  {Number} [options.vivaldi.error=50] Vivaldi default error
   * @param  {Number} [options.partialViewSize=5] Max Size of the partial view
   * @param  {Number} [options.pingDelta=10000] Time between each ping round (RTT recalculation)
   * @param  {Number} [options.timeoutDescriptor=30000] Time before it is timeout when we are asking
   * @param  {Object} options.fakeRtt Enabling a way to test our Implementation by fixing all latencies
   * @param  {Number[][]} options.fakeRtt.latencies Mirror matrix of latencies
   * @param  {Map} options.fakeRtt.revertedName Map of reverted name, each hosts
   * @param  {function} options.fakeRtt.compute Function that return the latency between myInViewId and peerInViewId in latencies and in revertedName
   * @return {[type]}         [description]
   */
  constructor(manager, options){
    let opt = lmerge({
      vivaldi: {
        error: 50
      },
      partialViewSize: 5,
      pingDelta: 10 * 1000,
      timeoutDescriptor: 30 * 1000,
      fakeRtt: {
        latencies: [[]],
        revertedName: new Map(),
        compute: (myInViewId, peerInViewId, latencies, revertedName) => Math.random() * 10 + 100
      }
    }, options);
    super(manager, opt);
    // specific options
    debug(this.options);
    this.rps._partialViewSize = () => this.options.partialViewSize;
    this.fakeRtt = this.options.fakeRtt;

    this.latencies = new Cache(this.options.timeout);

    // internal communications
    this.communication = new Communication(this, this.options.procotol+'-internal');
    this.communication.onUnicast((id, message) => {
      message = this.deserialize(message);

      // debug('tman: ', id, message);
      if(message.type && message.type === 'ping-descriptor'){
        // update coordinates of the descriptor we just received
        // this._updateDescriptor(message.owner, message.descriptor);
        message.type = 'pong-descriptor';
        message.descriptor = this.descriptor;
        message.owner = this.inviewId;
        try {
          if(this.getNeighbours(Infinity).includes(id)){
            this.communication.sendUnicast(id, this.serialize(message));
          }
        } catch (e) {
          console.log('pong tman:', e);
        }
      } else if (message.type && message.type === 'pong-descriptor') {
        this._updateDescriptor(message.owner, message.descriptor);
        this.emit('pong-descriptor-'+message.id, message);
      } else if (message.type && message.type === 'update-descriptor' && message.id && message.descriptor) {
        this._updateOurDescriptor(message.id, message.descriptor, message.rtt);
      }
    });
    if(this.rps.parent){
      this.communicationParent = new Communication(this.options.manager._rps.network, this.options.procotol+'-parent-internal');
      this.communicationParent.onUnicast((id, message) => {
        message = this.deserialize(message);

        if(message.type && message.type === 'ping-descriptor'){
          message.type = 'pong-descriptor';
          message.descriptor = this.descriptor;
          message.owner = this.inviewId;
          try {
            if(this.options.manager._rps.network.getNeighbours(Infinity).includes(id)){
              this.communicationParent.sendUnicast(id, this.serialize(message));
            }
          } catch (e) {
            console.log('pong parent:', e);
          }
        } else if (message.type && message.type === 'pong-descriptor') {
          this._updateDescriptor(message.owner, message.descriptor);
          this.emit('pong-descriptor-'+message.id, message);
        } else if (message.type && message.type === 'update-descriptor' && message.id && message.descriptor) {
          this._updateOurDescriptor(message.id, message.descriptor, message.rtt);
        }
      });
    }

    // access to our descriptor in the oldest function
    this.rps.partialView.descriptor = this.descriptor;
    this.rps.partialView.ranking = this.rps.options.ranking;
    delete this.rps.partialView.oldest;
    Object.defineProperty(this.rps.partialView, "oldest", {
      get: function () {
        if (this.size <= 0) { throw new ExPeerNotFound('getOldest'); };
        let elems = [];
        let mapIter = this.values();
        let val;
        while (val = mapIter.next().value) {
          elems.push(val);
        }
        // const rn = Math.floor(Math.random() * elems.length);
        // // console.log('SortByAges;', sortByAges);
        let sortByVivaldi = elems.slice().sort( this.ranking({descriptor: this.descriptor}) );
        // let sortByAges = sortByRtt.slice().sort((a, b) => (a.ages - b.ages));

        const oldest = sortByVivaldi[sortByVivaldi.length-1].peer
        // const oldest = sortByAges[sortByAges.length-1].peer
        // const oldest = elems[rn].peer
        return oldest;
      }
    });

    this.descriptor.peer = this.inviewId;

    delete this.rps._keep;
    this.rps.latencies = this.latencies;
    this.rps.fakeLatencies = this.fakeRtt;
    this.rps.inviewId = this.inviewId;
    this.rps.outviewId = this.outviewId;
    this.rps.parentFoglet = this;
    Object.defineProperty(this.rps, '_keep', {
      value: function (peerId){
        if(peerId !== this.inviewId){
          let ranked = [];
          this.partialView.forEach( (epv, neighbor) => ranked.push(epv));
          ranked.push({peer: peerId, descriptor: this.cache.get(peerId) });
          ranked.sort( (a, b) => {
            let rttA = this.latencies.get(a.peer), rttB = this.latencies.get(b.peer);
            console.log(rttA, rttB);
            return rttA - rttB
          });
          let sliced = ranked.slice(0, this._partialViewSize());
          ranked.splice(0, this._partialViewSize());
          // ranked becomes the rest: the lowest graded
          if (ranked.length === 0 || ranked.indexOf(peerId) < 0) {
              this.partialView.addNeighbor(peerId, this.cache.get(peerId));
          };
          ranked.forEach( (neighbor) => this.disconnect(neighbor.peer) );
        }
      }
    });

    delete this.rps._requestDescriptor;
    Object.defineProperty(this.rps, '_requestDescriptor', {
      value: function (peerId) {
        return new Promise( (resolve, reject) => {
            let to = null;
            const beginTime = (new Date()).getTime();
            this.send(peerId, new MRequestDescriptor(), this.options.retry).then( () => {
              to = setTimeout( () => {
                this.removeAllListeners(this.PID + '-' + peerId);
                reject('timeout'); // (TODO) throw exception
              }, this.options.descriptorTimeout);
            }).catch( (e) => {
                reject(e);
            });

            this.once(this.PID + '-' + peerId, (message) => {
              const endTime = (new Date()).getTime();
              clearTimeout(to);
              let rtt = endTime - beginTime;
              if(this.fakeLatencies) {
                rtt = this.fakeLatencies.compute(this.inviewId, peerId, this.fakeLatencies.latencies, this.fakeLatencies.revertedName);
              }
              this.latencies.set(peerId, rtt);
              this.cache.add(message.peer, message.descriptor);
              resolve();
            });
        });
      }
    })
  }

  /**
   * Create the descriptor at first step
   * @return {[type]} [description]
   */
	_startDescriptor () {
    this.intervalPing = setInterval(() => {
        let neigh = this.getNeighbours();
        neigh.forEach(peer => {
          if(!neigh.includes(this.inviewId)){
            this._pingUpdate(peer).then((result) => {
              this.communication.sendUnicast(peer, this.serialize({
                id: this.inviewId,
                type: 'update-descriptor',
                descriptor: this.descriptor,
                rtt: result.rtt
              }));
              this._sendLocalDescriptor(peer);
            }).catch(e => {
              console.log(e);
            });
          }
        });
        if(this.rps.parent) {
          let parentNeigh = this.options.manager._rps.network.getNeighbours();

          parentNeigh.forEach(peer => {
            if(!neigh.includes(peer)&& !neigh.includes(this.inviewId) && !parentNeigh.includes(this.inviewId)) {
              this._pingUpdateParent(peer).then((result) => {
                // send our descriptor to all parent neighbours for update
                this.communicationParent.sendUnicast(peer, this.serialize({
                  id: this.inviewId,
                  type: 'update-descriptor',
                  descriptor: this.descriptor,
                  rtt: result.rtt
                }));
                // send our local descriptor updated to all neighbors except for the previous one already sent
                this._sendLocalDescriptorParent(peer)
              }).catch(e => {
                console.log(e);
              });
            }
          });
        }
    }, this.options.pingDelta);
    let viv = vivaldi.create(this.options.vivaldi.error);
    this.coordinates = viv;
    return { coordinates: viv.toFloatArray() };
  }

  /**
   * Send our local descriptor with actual rtt to each peer for updates
   * @param  {string} except Id to not send the update request
   * @return {void}
   */
  _sendLocalDescriptor (except) {
    let desc = this.descriptor;
    this.getNeighbours(Infinity).forEach(peer => {
      if(peer !== except) {
        if(this.latencies.has(peer)){
          this.communication.sendUnicast(peer, this.serialize({
            id: this.inviewId,
            type: 'update-descriptor',
            descriptor: desc,
            rtt: this.latencies.get(peer)
          }));
        }
      }
    });
  }

  /**
   * Send our local descriptor with actual rtt to each peer for updates
   * @param  {string} except Id to not send the update request
   * @return {void}
   */
  _sendLocalDescriptorParent (except) {
    let desc = this.descriptor;
    this.options.manager._rps.network.getNeighbours(Infinity).forEach(peer => {
      if(peer !== except) {
        if(this.latencies.has(peer)){
          this.communicationParent.sendUnicast(peer, this.serialize({
            id: this.inviewId,
            type: 'update-descriptor',
            descriptor: desc,
            rtt: this.latencies.get(peer)
          }));
        }
      }
    });
  }

  /**
   * Update the RTT between us and specified peer, update information in the cache and update our descriptor
   * @param  {[type]} peer PeerId
   * @return {Promise}
   */
  _pingUpdate(peer) {
    return new Promise((resolve, reject) => {
      // compute the ping and get the remote descriptor
      this._ping(peer).then((result) => {
        this.latencies.set(peer, result.rtt);
        this._updateDescriptor(peer, result.descriptor);
        this._updateOurDescriptor(peer, result.descriptor, result.rtt);
        resolve(result);
      }).catch(e => {
        console.log('ping: ', e);
        reject(e); //reject(e);
      });
    });
  }

  /**
   * Update the Parent RTT between us and specified Parent peer, update information in the cache and update our descriptor
   * @param  {[type]} peer PeerId
   * @return {Promise}
   */
  _pingUpdateParent(peer) {
    return new Promise((resolve, reject) => {
      // compute the ping and get the remote descriptor
      this._pingParent(peer).then((result) => {
        this.latencies.set(peer, result.rtt);
        this._updateDescriptor(peer, result.descriptor);
        this._updateOurDescriptor(peer, result.descriptor, result.rtt);
        resolve(result);
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
            descriptor: this.descriptor
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
            descriptor: this.descriptor
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
  _updateDescriptor(id, descriptor) {
    if(!this.rps.cache.has(id)){
      this.rps.cache.add(id, descriptor);
    } else {
      this.rps.cache.set(id, descriptor);
    }
    if(this.rps.partialView.has(id)){
      this.rps.partialView.updateNeighbor(id, descriptor);
    }
  }

  /**
   * Update our coordinates according to all coordinates we have in our cache.
   * @return {[type]} [description]
   */
  _updateCoordinates(){
    const cache = this.rps.cache;
    cache.forEach(c => {
      let correspondigRtt = this.latencies.get(c.peer);
      if(correspondigRtt){
        // debug('[%s]: ', this.inviewId, this.coordinates);
        vivaldi.update(correspondigRtt, this.coordinates, this._createHeighFromDescriptor(c));
      }
    })
    this.descriptor.coordinates = this.coordinates.toFloatArray();
  }

  /**
   * Update our Descriptor by updating our position
   * @param  {[type]} id         Remote peer id
   * @param  {[type]} descriptor Remote descriptor
   * @param  {[type]} rtt        Rtt between us and Peer id
   * @return {boolean} Return true or false, Vivaldi update state.
   */
  _updateOurDescriptor(id, descriptor, rtt) {
    this.latencies.set(id, rtt);
    let res = false;
    try {
      // update our position from the new rtt
      const remoteCoordinates = this._createHeighFromDescriptor(descriptor);
      res = vivaldi.update(rtt, this.coordinates, remoteCoordinates);
      this.descriptor.coordinates = this.coordinates.toFloatArray();
      // re compute on all previous coordinates
      this._updateCoordinates();
      this.rps.options.descriptor = this.descriptor;

    } catch (error) {
      console.log(error);
    }
    return res;
  }

  /**
   * Getter: the Descriptor Timeout
   * @return {[type]} [description]
   */
  _descriptorTimeout () {
    return this.options.timeoutDescriptor;
  }

  /**
   * Create Position from a Descriptor
   * @param  {Object} desc Descriptor
   * @return {VivaldiPosition}
   */
  _createHeighFromDescriptor (desc) {
    return vivaldi.VivaldiPosition.fromFloatArray(desc.coordinates);
  }

  /**
   * Return the distance between 2 descriptors
   * @param  {[type]} desc1 [description]
   * @param  {[type]} desc2 [description]
   * @return {[type]}       [description]
   */
  _vivaldiDistance (desc1, desc2) {
    return vivaldi.distance(this._createHeighFromDescriptor(desc1), this._createHeighFromDescriptor(desc2));
  }

  /**
   * Ranking method applied on descriptor A and B for the descriptor Neighbours
   * @param  {[type]} neighbours  Descriptor on which we based our ranking
   * @param  {[type]} descriptorA Ranking descriptor A
   * @param  {[type]} descriptorB Ranking Descriptor B
   * @return {[type]} Rank elements according to their descriptor,  we keep DescriptorA if < 0, Descriptor B if > 0, none if === 0
   */
  _rankPeers (neighbours, descriptorA, descriptorB) {
    const da = Math.round(this._vivaldiDistance(neighbours.descriptor, descriptorA));
    const db = Math.round(this._vivaldiDistance(neighbours.descriptor, descriptorB));
    if(isNaN(da) && isNaN(db)) return -1;
    if(isNaN(da)) return 1;
    if(isNaN(db)) return -1;
    return Math.round(da - db);
  }

}

module.exports = LatencyOverlay;
