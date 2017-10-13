const Foglet = require('foglet-core');
const vivaldi = require('vivaldi-coordinates');

class LatencyOverlay extends Foglet.abstract.tman{
	_startDescriptor () {
    return { coordinates: vivaldi.create() };
  }

  _descriptorTimeout () {
    return 30 * 1000;
  }

  _rankPeers (neighbours, descriptorA, descriptorB) {
    return descriptorA.x <= descriptorB.x;
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
