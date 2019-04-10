//BN lib.
var BN = require("bignumber.js");
BN.config({
    ROUNDING_MODE: BN.ROUND_DOWN,
    EXPONENTIAL_AT: process.settings.coin.decimals + 1
});

//Vars from the settings.
var pools = process.settings.pools;
var symbol = process.settings.coin.symbol;

module.exports = async (msg) => {
    //Tip details.
    var pool, from, to, amount;

    //Tip from an user.
    if (msg.text.length === 3) {
        //Set the tip's details.
        pool = false;
        from = msg.sender;
        to = msg.text[1].replace("!", ""); //Turn <!@ into <@.
        amount = msg.text[2];
    //Tip from a pool.
    } else if (msg.text.length === 4) {
        //Declare that this a pool tip.
        pool = true;
        //Set the from, and then verify the pool status.
        from = msg.text[1];
        //Verify the pool exists.
        if (Object.keys(pools).indexOf(from) === -1) {
            msg.obj.reply("That pool doesn't exist.");
            return;
        }

        //Verify the user can tip from that pool.
        if (
            (pools[from].admins.indexOf(msg.sender) === -1) &&
            (pools[from].members.indexOf(msg.sender) === -1)
        ) {
            msg.obj.reply("You can't tip from that pool.");
            return;
        }

        //Verify this isn't a PM as pool tips shpuld be public info.
        if (msg.obj.channel.toString().indexOf("@") > -1) {
            msg.obj.reply("You can't use pools in PM.");
            return;
        }

        to = msg.text[2].replace("!", ""); //Turn <!@ into <@.
        amount = msg.text[3];
    //If there was a different argument length, there was the wrong amount of arguments.
    } else {
        msg.obj.reply("You used the wrong amount of arguments.");
        return;
    }

    if (amount === "all") {
        //Set the amount to the user's balance.
        amountWFee = await process.core.users.getBalance(from);
        amount = amountWFee.minus(BN(process.settings.coin.withdrawFee));     
    //Else...
    } else {
        //Parse amount into a BN, yet make sure we aren't dealing with < 1 satoshi.
        amount = BN(BN(amount).toFixed(process.settings.coin.decimals));
        amountWFee = amount.plus(BN(process.settings.coin.withdrawFee));
    }

    //If this is not a valid user, or a pool we're sending to...
    if (
        (
            (to.substr(0, 2) !== "<@") ||
            (to.substr(to.length-1) !== ">") ||
            (Number.isNaN(parseInt(to.substring(2, to.length-1))))
        ) && (Object.keys(pools).indexOf(to) === -1)
    ) {
        msg.obj.reply("You are not tipping to a valid person. Please put @ in front of their name and click the popup Discord provides.");
        return;
    }
    //Strip the characters around the user ID.
    if (to.indexOf("<@") > -1) {
        to = to.substring(2, to.length-1);
    }

    //Stop pointless self sends.
    if (from === to) {
        msg.obj.reply("You cannot send to yourself.");
        return;
    }

    //Subtract the balance from the user.
    if (!(await process.core.users.subtractBalance(from, amountWFee))) {
        //If that failed...
        msg.obj.reply("Your number is either invalid, negative, or you don't have enough.");
        return;
    }

    //Create an account for the user if they don't have one.
    await process.core.users.create(to).catch(err => {
        console.log(err)
    });
    //If we made it past the checks, send the funds.
    
    var address = await process.core.users.getAddress(to);
    var hash = await process.core.coin.send(address, amount);
    
    if (typeof(hash) !== "string") {
        msg.obj.reply("Our node failed to create a TX! Is your address invalid?");
        return;
    }

    await process.core.users.addTransaction(from, amount, hash, 'send');

    msg.obj.reply("Sent " + amount + " " + symbol + " to " + (Number.isNaN(parseInt(to)) ? pools[to].printName : "<@" + to + ">") + (pool ? " via the " + pools[from].printName + " pool" : "") + ". TXID is " + hash);
    
    if (pool) {
        for (var i in pools[from].admins) {
            process.client.users.get(pools[from].admins[i]).send(pools[from].printName + " pool update: <@" + msg.sender + "> sent " + amount + " " + symbol + " to <@" + to + ">.");
        }
    }
};
