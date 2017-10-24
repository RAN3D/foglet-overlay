const TMan = require('foglet-core').abstract.tman;
const Communication = require('foglet-core').communication;
const vivaldi = require('vivaldi-coordinates');
const debug = require('debug')('overlay:latency')
const lmerge = require('lodash.merge');
const uuid = require('uuid/v4');
const Cache = require('./jaccard/cache.js');

class JaccardOverlay extends TMan{
  constructor(...args){
    super(...args);

    // specific options
    this.partialViewSize = this.options.partialViewSize || 5;
    this._rps._partialViewSize = () => this.partialViewSize;
    this.cache = new Cache(this.options.cache);

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
    return { cache: new Cache() };
  }

  _updateDescriptor(id, descriptor) {
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
    let coordA = vivaldi.create(new vivaldi.HeightCoordinates(descriptorA.coordinates._coordinates.x, descriptorA.coordinates._coordinates.y, descriptorA.coordinates._coordinates.h));
    let coordNeig = vivaldi.create(new vivaldi.HeightCoordinates(neighbours.descriptor.coordinates._coordinates.x, neighbours.descriptor.coordinates._coordinates.y, neighbours.descriptor.coordinates._coordinates.h));
    let coordB = vivaldi.create(new vivaldi.HeightCoordinates(descriptorB.coordinates._coordinates.x, descriptorB.coordinates._coordinates.y, descriptorB.coordinates._coordinates.h));
    const da = vivaldi.distance(coordNeig, coordA);
    const db = vivaldi.distance(coordNeig, coordB);
    // debug('Rankpeers: me:', neighbours, neighbours.descriptor.coordinates._coordinates, descriptorA.coordinates._coordinates, descriptorB.coordinates._coordinates);
    if(isNaN(da) && isNaN(db)) return 0;
    if(isNaN(da)) return db;
    if(isNaN(db)) return da;
    return da - db;
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

module.exports = JaccardOverlay;
