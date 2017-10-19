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
    this.fakeRtt = this.options.fakeRtt || undefined;

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
            const remoteCoordinates = vivaldi.create(new vivaldi.HeightCoordinates(obj.x, obj.y, obj.h));
            this._ping(peer).then((rtt) => {
              debug(`Ping: (${peer},${rtt})`);
              vivaldi.update(rtt, this.descriptor.coordinates, remoteCoordinates);
              this.communication.sendUnicast(peer, {
                type: 'update-descriptor',
                id: this.inviewId,
                descriptor: this._rps.cache.get(peer)
              });
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
    debug('Descriptor updated:', id, descriptor);
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
    // debug('Rankpeers: me:', neighbours, neighbours.descriptor.coordinates._coordinates, descriptorA.coordinates._coordinates, descriptorB.coordinates._coordinates);
    const da = vivaldi.distance(vivaldi.create(
      new vivaldi.HeightCoordinates(neighbours.descriptor.coordinates._coordinates.x, neighbours.descriptor.coordinates._coordinates.y, neighbours.descriptor.coordinates._coordinates.h), neighbours.descriptor.coordinates),
      new vivaldi.HeightCoordinates(descriptorA.coordinates._coordinates.x, descriptorA.coordinates._coordinates.y, descriptorA.coordinates._coordinates.h)
    );
    const db = vivaldi.distance(vivaldi.create(
      new vivaldi.HeightCoordinates(neighbours.descriptor.coordinates._coordinates.x, neighbours.descriptor.coordinates._coordinates.y, neighbours.descriptor.coordinates._coordinates.h), neighbours.descriptor.coordinates),
      new vivaldi.HeightCoordinates(descriptorB.coordinates._coordinates.x, descriptorB.coordinates._coordinates.y, descriptorB.coordinates._coordinates.h)
    );
    debug('Raking: (da,db) = ', `(${da},${db})`);
    return da < db;
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
              resolve(this.fakeRtt);
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
