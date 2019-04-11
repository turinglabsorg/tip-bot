//Get variables from the settings.
var bot = process.settings.discord.user;
var symbol = process.settings.coin.symbol;
var decimals = process.settings.coin.decimals;
var fee = process.settings.coin.withdrawFee;
var botsymbol = process.settings.discord.symbol;

//Default help tect.
var help = `
**TIPBOT COMMAND LIST**

To run a command, either preface it with "` + botsymbol + `" ("!deposit", "!tip") or ping the bot ("<@${bot}> deposit", "<@${bot}> tip").

This bot does use decimals, and has ${decimals} decimals of accuracy. You can also use "all" instead of any AMOUNT to tip/withdraw your entire balance.

-- *` + botsymbol + `balance*
Prints your balance.

-- *` + botsymbol + `tip <@PERSON> <AMOUNT>*
Tips the person that amount of ${symbol}.

-- *` + botsymbol + `withdraw <AMOUNT> <ADDRESS>*
Withdraws AMOUNT to ADDRESS, charging a ${fee} ${symbol} fee.

-- *` + botsymbol + `deposit*
Prints your personal deposit address.
`;

module.exports = async (msg) => {
    msg.obj.author.send({
        embed: {
            description: help
        }
    });
};
