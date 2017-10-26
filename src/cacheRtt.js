
/**
 * Cache that will store rtt;
 */
module.exports = class Cache {
  constructor(timeout){
    this.cache = {};
    this.timeout = timeout;
  }

  /**
   * Return true if the contains name
   * @param {*} name 
   */
  has(name){
    return Object.keys(this.cache).includes(name);
  }

  /**
   * Return the value corresponding to its name, undefined otherwise
   * @param {*} name 
   */
  get(name) {
    if(this.has(name)) 
      return this.cache[name];
    else
      return undefined;
  }

  /**
   * Add a new rtt for the corresponding name, it will be removed after a while.
   * @param {*} name 
   * @param {*} rtt 
   */
  add(name, rtt) {
    this.cache[name] = rtt;
    setTimeout(() => {
      delete this.cache[name];
    }, this.timeout);
  }

  /**
   * Set the rtt for the corresponding name
   * @param {*} name 
   * @param {*} rtt 
   */
  set(name, rtt) {
    if(this.has(name))
      this.cache[name] = rtt;
    else
      this.add(name, rtt);
  }

  /**
   * Loop over a cache and call the callback each time we reach a value (k, v) => {...}
   * @param {*} cache 
   * @param {*} callback 
   */
  forEach(cache, callback){
    let keys = Object.keys(cache);
    keys.forEach(k => callback(k, cache[k]));
  }

  /**
   * Update the cache from another cache
   * @param {*} cache 
   */
  updateFrom(cache) {
    this.forEach(cache, (name, rtt) => {
      this.set(name, rtt);
    });
  }
}