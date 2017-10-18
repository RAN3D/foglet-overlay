const TMan = require('foglet-core/src/network/abstract/tman-overlay.js');
const vivaldi = require('vivaldi-coordinates');
const debug = require('debug')('overlay:latency')
const lmerge = require('lodash.merge');

class LatencyOverlay extends TMan{
	_startDescriptor () {
    this.intervalPing = setInterval(() => {
        console.log('Neighbours: ', this.getNeighbours())
        this..forEach(peer => {
          this._ping(peer).then((rtt) => {
            vivaldi.update(rtt, this._descriptor.coordinates)
          });
        });
    }, this._descriptorTimeout());
    let viv = vivaldi.create();
    debug('StartDescriptor: ', viv);
    return { coordinates: viv };
  }

  _descriptorTimeout () {
    return 10 * 1000;
  }

  _rankPeers (neighbours, descriptorA, descriptorB) {
    debug('Rankpeers: ', neighbours, descriptorA.coordinates, descriptorB.coordinates);
    return 0;
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
					sourcei: this.inviewId,
					sourceo: this.outviewId,
					type: 'ping'
				}).catch(error => {
					reject(error);
				});
				this.once('pong-'+idMessage, (msg) => {
					// listening for an incoming response of our ping
					// double check if message is a goood message,
					if(msg.id === idMessage) {
						let time = (new Date()).getTime() - pingTime;
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
