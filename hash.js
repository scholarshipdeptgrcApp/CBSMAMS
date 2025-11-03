const bcrypt = require('bcryptjs');

const password = 'MyStr0ngP@ssw0rd!';
bcrypt.hash(password, 10, (err, hash) => {
  if (err) throw err;
  console.log(hash); // copy this hash
});
