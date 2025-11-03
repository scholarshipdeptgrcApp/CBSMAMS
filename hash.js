const bcrypt = require('bcrypt');

const plainPassword = 'password123';
bcrypt.hash(plainPassword, 10, (err, hash) => {
    if (err) throw err;
    console.log(hash);
});
