
let a  = new Promise((resolve, reject) => {
  resolve ('toto', 'toto', 'titi');
});

a.then((a, b, c) => {
  console.log(a, b, c);
});
