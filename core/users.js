//MySQL and BN libs.
var mysql = require("promise-mysql");
var BN = require("bignumber.js");
BN.config({
    ROUNDING_MODE: BN.ROUND_DOWN,
    EXPONENTIAL_AT: process.settings.coin.decimals + 1
});

//Definition of the table: `name VARCHAR(64), address VARCHAR(64), balance VARCHAR(64), notify tinyint(1)`.

//MySQL connection and table vars.
var connection, table;

//RAM cache of users.
var users;

//Array of every handled TX hash.
var handled;

//Checks an amount for validity.
async function checkAmount(amount) {
    //If the amount is invalid...
    if(!amount){
        return false
    }
    //Else, return true.
    return true;
}

//Creates a new user.
async function create(user) {
    //If the user already exists, return.
    if (users[user]) {
        return false;
    }

    //Create the new user, with a blank address, balance of 0, and the notify flag on.
    await connection.query("INSERT INTO " + table + " VALUES(?, ?, ?, ?)", [user, "", "0", 1]);
    //Create the new user in the RAM cache, with a status of no address, balance of 0, and the notify flag on.
    users[user] = {
        address: false,
        balance: BN(0),
        notify: true
    };
    await process.core.users.setAddress(user, await process.core.coin.createAddress(user));

    //Return true on success.
    return true;
}

//Sets an user's address.
async function setAddress(user, address) {
    //If they already have an addrwss, return.
    if (typeof(users[user].address) === "string") {
        return;
    }

    //Update the table with the address.
    await connection.query("UPDATE " + table + " SET address = ? WHERE name = ?", [address, user]);
    //Update the RAM cache.
    users[user].address = address;
}

//Adds transaction to database.

async function addTransaction(user, amount, txid, type, timestamp = ''){
    amount =  parseFloat(BN(amount).toFixed(8))
    if(amount <= 0){
        return false;
    }
    var address = users[user].address
    if(address.length !== 34){
        await process.core.users.setAddress(user, await process.core.coin.createAddress(user));
    }

    if(timestamp === ''){
        timestamp = Date.now()
    }
    
    if(txid !== 'internaltransaction'){
        var check = await connection.query("SELECT * FROM transactions WHERE txid = '" + txid + "' AND address = '" + address + "'");
        if(!check[0]){
            await connection.query("INSERT INTO transactions VALUES (?, ?, ?, ?, ?)", [txid, address, amount, type, timestamp]);
        }
    }else{
        await connection.query("INSERT INTO transactions VALUES (?, ?, ?, ?, ?)", [txid, address, amount, type, timestamp]);
    }

    return true;
}

//Adds to an user's balance.

async function addBalance(user, amount) {
    //Return false if the amount is invalid.
    amount = parseFloat(amount)
    if (!(await checkAmount(amount))) {
        return false;
    }

    if(amount <= 0){
        return false;
    }
    
    //await addTransaction(user, parseFloat(amount), "internaltransaction", 'receive')
    //await fixBalance(user)
    return true;
}

//Subtracts from an user's balance.
async function subtractBalance(user, amount) {
    //Return false if the amount is invalid.

    amount = parseFloat(amount)
    if (!(await checkAmount(amount))) {
        return false;
    }

    if(amount <= 0){
        return false;
    }
    var balance = await getBalance(user)
    if(amount > balance){
        return false
    }
    //await addTransaction(user, parseFloat(amount), "internaltransaction", 'send')
    //await fixBalance(user)
    return true;
}

async function fixBalance(user){
    var address = users[user].address
    if(address.length !== 34){
        return false;
    }
    var rows = await connection.query("SELECT * FROM transactions WHERE address = '" + address + "'");
    //Iterate over each row, creating an user object for each.
    var i;
    var balance = 0;
    for (i in rows) {
        if(rows[i].type === 'receive'){
            balance += parseFloat(rows[i].amount)
        }
        if(rows[i].type === 'send'){
            balance -= parseFloat(rows[i].amount)
        }
    }

    users[user].balance = balance
    await connection.query("UPDATE users SET balance = ? WHERE name = ?", [balance, user]);
}

//Updates the notify flag.
async function setNotified(user) {
    //Update the table with a turned off notify flag.
    await connection.query("UPDATE " + table + " SET notify = ? WHERE name = ?", [0, user]);
    //Update the RAM cache.
    users[user].notify = false;
}

//Returns an user's address.
async function getAddress(user) {
    return users[user].address;
}

//Returns an user's balance
async function getBalance(user) {
    await fixBalance(user)
    return users[user].balance;
}

//Returns an user's notify flag.
async function getNotify(user) {
    return users[user].notify;
}

module.exports = async () => {
    //Connects to MySQL.
    connection = await mysql.createConnection({
        host: "localhost",
        database: process.settings.mysql.db,
        user: process.settings.mysql.user,
        password: process.settings.mysql.pass
    });
    //Sets the table from the settings.
    table = process.settings.mysql.table;

    //Init the RAM cache.
    users = {};
    //Init the handled array.
    handled = [];
    //Gets every row in the table.
    var rows = await connection.query("SELECT * FROM " + table);
    //Iterate over each row, creating an user object for each.
    var i;
    for (i in rows) {
        users[rows[i].name] = {
            //If the address is an empty string, set the value to false.
            //This is because we test if the address is a string to see if it's already set.
            address: (rows[i].address !== "" ? rows[i].address : false),
            //Set the balance as a BN.
            balance: BN(rows[i].balance),
            //Set the notify flag based on if the DB has a value of 0 or 1 (> 0 for safety).
            notify: (rows[i].notify > 0)
        };

        //Get this user's existing TXs.
        var txs = await process.core.coin.getTransactions(users[rows[i].name].address);
        //Iterate over each, and push their hashes so we don't process them again.
        var x;
        for (x in txs) {
            handled.push(txs[x].txid);
            await addTransaction(rows[i].name, txs[x].amount, txs[x].txid, txs[x].category, txs[x].time)
        }
    }

    //Make sure all the pools have accounts.
    for (i in process.settings.pools) {
        //Create an account for each. If they don't have one, this will do nothing.
        await create(i);
    }

    //Return all the functions.
    return {
        create: create,
        setAddress: setAddress,
        addBalance: addBalance,
        subtractBalance: subtractBalance,
        setNotified: setNotified,
        addTransaction: addTransaction,
        getAddress: getAddress,
        getBalance: getBalance,
        getNotify: getNotify
    };
};

//Every thirty seconds, check the TXs of each user.
setInterval(async () => {
    //console.log('FETCHING INCOMING TRANSACTIONS')
    for (var user in users) {
        //If that user doesn't have an address, continue.
        if (users[user].address === false) {
            continue;
        }

        //Declare the amount deposited.
        var balance = BN(0);
        //Get the TXs.
        var txs = await process.core.coin.getTransactions(users[user].address);

        //Iterate over the TXs.
        var i;
        for (i in txs) {
            //If we haven't handled them...
            if (handled.indexOf(txs[i].txid) === -1) {
                //Push the TX ID so we don't handle it again.
                handled.push(txs[i].txid);
                await addTransaction(user, txs[i].amount, txs[i].txid, txs[i].category, txs[i].time);
            }
        }

        await fixBalance(user).catch(err => {
            console.log(err)
        })
    }
}, 30 * 1000);
