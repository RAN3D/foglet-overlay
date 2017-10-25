const vivaldi = require('vivaldi-coordinates');

let a = vivaldi.create();
let b = vivaldi.create();
let c = vivaldi.create();

let da, db, dc;
da = { x: 0, coordinates: a}
db = { x: 1, coordinates: b}
dc = { x: 2, coordinates: c}

vivaldi.update(10, a, b);
vivaldi.update(20, b, a);
vivaldi.update(40, c, a);

function createHeighFromDescriptor (desc) {
  console.log(desc);
  return new vivaldi.VivaldiPosition(new vivaldi.HeightCoordinates(desc.coordinates._coordinates.x, desc.coordinates._coordinates.y, desc.coordinates._coordinates.h ));
}

let ac = vivaldi.distance(createHeighFromDescriptor(da), createHeighFromDescriptor(dc));
console.log(ac);
