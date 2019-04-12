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
    await setAddress(user, await process.core.coin.createAddress(user));

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

//Adds reward to database

async function addReward(tx, address){
    if (handled.indexOf(tx.txid) === -1) {
        handled.push(tx.txid);
        var type = 'staked'
        var txid = tx.txid
        var vout = tx.vout
        var timestamp = tx.time

        var check = await connection.query("SELECT * FROM transactions WHERE txid = '" + txid + "' AND address = '" + address + "' AND vout='"+vout+"' AND type='"+type+"'");
        if(!check[0]){
            var amount = await process.core.coin.getStakingReward(tx, address)
            if(amount > 0){
                await connection.query("INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?)", [txid, address, amount, type, timestamp, vout]);
            }
        }
    }
}

//Adds transaction to database.

async function addTransaction(tx){
    var amount =  parseFloat(BN(tx.amount).toFixed(8))
    var address = tx.address
    var txid = tx.txid
    var timestamp = tx.time
    var type = tx.category
    var vout = tx.vout

    if(amount > 0){
        var checkaddress = await process.core.coin.checkSender(tx);
        if(checkaddress === false){
            var check = await connection.query("SELECT * FROM transactions WHERE txid = '" + txid + "' AND address = '" + address + "' AND vout='"+vout+"' AND type='"+type+"'");
            if(!check[0]){
                await connection.query("INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?)", [txid, address, amount, type, timestamp, vout]);
            }
        }else{
            var amount = await process.core.coin.fixAmountSend(address, tx, amount);
            amount = parseFloat(amount.toFixed(8))
            type = 'send'
            var check = await connection.query("SELECT * FROM transactions WHERE txid = '" + txid + "' AND address = '" + address + "' AND vout='"+vout+"' AND type='"+type+"'");
            if(!check[0]){
                await connection.query("INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?)", [txid, address, amount, type, timestamp, vout]);
            }
        }
    }

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
    return true;
}

//Calculate correct balance
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
        if(rows[i].type === 'receive' || rows[i].type === 'staked'){
            balance += parseFloat(rows[i].amount)
        }
        if(rows[i].type === 'send'){
            balance -= parseFloat(rows[i].amount)
        }
    }
    balance = parseFloat(balance.toFixed(8))
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
    return parseFloat(users[user].balance.toFixed(8))
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

        //Get the TXs.
        var txs = await process.core.coin.getTransactions(users[user].address);
        //console.log('PARSING TRANSACTIONS')
        //Iterate over the TXs.
        var i;
        for (i in txs) {
            if (handled.indexOf(txs[i].txid) === -1) {
                if(!txs[i].generated){
                    await addTransaction(txs[i], users[user].address);
                }else{
                    await addReward(txs[i], users[user].address);
                }
            }
            //handled.push(txs[i].txid);
        }

        await fixBalance(user).catch(err => {
            console.log(err)
        })
    }
}, 5 * 1000);