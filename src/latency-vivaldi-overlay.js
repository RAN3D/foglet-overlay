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

class LatencyOverlay extends TMan{
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
          // update coordinates of the descriptor we just received
          // this._updateDescriptor(message.owner, message.descriptor);

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

    // delete this.rps._onExchangeBack;
    // Object.defineProperty(this.rps, "_onExchangeBack", {
    //   value: function (peerId, message) {
    //     // #1 keep the best elements from the received sample
    //     let ranked = [];
    //     this.partialView.forEach( (epv, neighbor) => ranked.push(epv));
    //     message.sample.forEach( (e) => ranked.indexOf(e) < 0 && ranked.push(e) );
    //     if(this.parent){
    //       this.parent.partialView.forEach((array, peer) => {
    //         if(ranked.indexOf(peer) < 0 && this.cache.has(peer)) {
    //           const p = { peer, descriptor: this.cache.get(peer)};
    //           ranked.push(p);
    //           // debug('[%s] %s =X> Add a parent neighbour in the list: ', this.PID, this.PEER, p);
    //         }
    //       });
    //     }
    //
    //     ranked.sort( this.options.ranking(this.options) );
    //     // #2 require the elements
    //     let request = [];
    //     ranked.forEach( (e) => {
    //         if (!this.partialView.has(e.peer)) {
    //             request.push(e.peer);
    //             this.cache.add(e.peer, e.descriptor);
    //         }
    //     });
    //     request = request.slice(0, this._partialViewSize());
    //
    //     if (request.length > 0) {
    //         // debug('[%s] %s wants to keep %s peers. ',
    //         //       this.PID, this.PEER, request.length );
    //         this.send(peerId, new MRequire(request), this.options.retry)
    //             .catch( (e) => {
    //                 // debug('[%s] %s =X> request descriptors %s =X> %s',
    //                 //       this.PID, this.PEER, request.length, peerId);
    //             });
    //     }
    //
    //     let rest = ranked.slice(this._partialViewSize(), ranked.length);
    //     if (rest.length > 0 && this.partialView.size > this._partialViewSize()){
    //         rest.forEach( (p) => {
    //             this.partialView.has(p.peer) && this.disconnect(p.peer);
    //         });
    //     }
    //   }
    // });

    // delete this.rps._exchange;
    // Object.defineProperty(this.rps, '_exchange', {
    //   value: function () {
    //     // #0 if the partial view is empty --- could be due to disconnections,
    //     // failure, or _onExchange started with other peers --- skip this round.
    //     if (this.partialView.size <= 0 &&
    //         this.parent && this.parent.partialView.size <= 0) {
    //         return;
    //     }
    //     this.partialView.increment();
    //     // #1 get the oldest peer in our partial view. If the partial view is
    //     // empty, fall back to parent's partial view.
    //     let chosen, chosen_array = [];
    //     let sample, sample_array = [];
    //     let fromOurOwn = true;
    //     if (this.partialView.size > 0) {
    //         // #A use our own partial view
    //         // chosen = this.partialView.oldest;
    //         // sample = this._getSample(this.partialView.get(chosen));
    //         this.partialView.forEach( (v,k) => chosen_array.push(k));
    //         sample_array = chosen_array.map((peer) => this._getSample(this.partialView.get(peer)));
    //     } else if (this.parent && this.parent.partialView.size > 0) {
    //         // #B use the partial view of our parent
    //         let rnNeighbors = this.parent.getPeers();
    //         let found = false;
    //         fromOurOwn = false;
    //         while (!found && rnNeighbors.length > 0){
    //             const rn = Math.floor(Math.random() * rnNeighbors.length);
    //             if (this.cache.has(rnNeighbors[rn])){
    //                 found = true;
    //                 chosen_array.push(rnNeighbors[rn]);
    //                 sample_array.push(this._getSample({peer: chosen_array[0],
    //                                           descriptor: this.cache.get(chosen_array[0])
    //                                         }));
    //             } else {
    //                 rnNeighbors.splice(rn, 1);
    //             };
    //         };
    //     };
    //     // #2 propose the sample to the chosen one
    //     debug('[%s] want to send sample: ', this.PEER, chosen_array, sample_array);
    //     for(let i = 0; i < chosen_array.length; ++i){
    //       chosen_array[i] !== this.getInviewId()
    //         && this.send(chosen_array[i],new MSuggest(this.getInviewId(), this.options.descriptor, sample_array[i])).then( () => {
    //         // #A it seems the message has been sent correctly
    //         //debug('[%s] %s ==> suggest %s ==> %s', this.PID, this.PEER, sample_array[i].length, chosen_array[i]);
    //       }).catch( (e) => {
    //          // #B the peer cannot be reached, he is supposedly dead
    //          //debug('[%s] %s =X> suggest =X> %s',   this.PID, this.PEER, chosen_array[i]);
    //          fromOurOwn && this._onPeerDown(chosen_array[i]);
    //       });
    //     }
    //   }
    // });

    delete this.rps._keep;
    this.rps.latencies = this.latencies;
    this.rps.fakeLatencies = this.fakeRtt;
    this.rps.inviewId = this.inviewId;
    this.rps.outviewId = this.outviewId;
    this.rps.parentFoglet = this;
    Object.defineProperty(this.rps, '_keep', {
      value: function (peerId){
        if(peerId !== this.inviewId){
          if (this.partialView.size === 0 || !this.partialView.has(peerId)) {
            this.partialView.addNeighbor(peerId, this.cache.get(peerId));
          };

          let promiseAll = [];
          this.partialView.forEach(p => {
            console.log(p.peer);
            promiseAll.push(p.peer);
          })
          let ranked = [];
          this.partialView.forEach( (epv, neighbor) => ranked.push(epv));
          promiseAll = promiseAll.map(id => this.parentFoglet._pingUpdate(id));
          Promise.all(promiseAll).then((result) => {
            ranked.sort( (a, b) => {
              let rttA = this.latencies.get(a.peer), rttB = this.latencies.get(b.peer);
              console.log(rttA, rttB);
              // let rttA = this.fakeLatencies.latencies[this.fakeLatencies.revertedName.get(a.peer)][this.fakeLatencies.revertedName.get(this.inviewId)];
              // let rttB = this.fakeLatencies.latencies[this.fakeLatencies.revertedName.get(b.peer)][this.fakeLatencies.revertedName.get(this.inviewId)];
              // console.log(a, b, rttA, rttB, this.inviewId, this.fakeLatencies.revertedName.get(a.peer), this.fakeLatencies.revertedName.get(b.peer), this.fakeLatencies);
              return rttA - rttB
              // return rttA - rttB;
            });
            debug('[Keep]: after ping update', result, ranked);
            // ranked.sort(this.options.ranking(this.options));
            let sliced = ranked.slice(0, this._partialViewSize());
            ranked.splice(0, this._partialViewSize());
            // console.log(sliced, ranked, save, this.latencies);
            ranked.forEach( (neighbor) => this.disconnect(neighbor.peer) );
          }).catch(e => {
            debug('[%s] Error: ', this.inviewId, e);
          });
        }
      }
    })

    this.rps.on('open', (peerId) => {
        debug('New connection: ', peerId);
    });
  }

  serialize(message) {
    return Serialize(message, {isJSON: true});
  }

  deserialize(message) {
    return eval('(' + message + ')');
  }

	_startDescriptor () {
    this.intervalPing = setInterval(() => {
        // console.log('Neighbours: ', this.getNeighbours(), this.rps.cache);
        let neigh = this.getNeighbours();
        neigh.forEach(peer => {
          if(!neigh.includes(this.inviewId)){
            this._pingUpdate(peer).then((result) => {
              // console.log('Updated our position from tman neighbours');
              // send our descriptor to all neighbours for update
              // debug('[%s] new rtt tman from [%s]: ', this.inviewId, peer, result);
              this.communication.sendUnicast(peer, this.serialize({
                id: this.inviewId,
                type: 'update-descriptor',
                descriptor: this.descriptor,
                rtt: result.rtt
              }));
              // send our local descriptor updated to all neighbors except for the previous one already sent
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
                // debug('[%s] new rtt parent from [%s]: ', this.inviewId, peer, result);
                // console.log('Updated our position from parent neighbours');
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
    const da = Math.round(this._vivaldiDistance(neighbours.descriptor, descriptorA));
    const db = Math.round(this._vivaldiDistance(neighbours.descriptor, descriptorB));
    if(isNaN(da) && isNaN(db)) return -1;
    if(isNaN(da)) return 1;
    if(isNaN(db)) return -1;
    return Math.round(da - db);
  }

}

module.exports = LatencyOverlay;
