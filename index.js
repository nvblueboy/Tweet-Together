const config = require("./config.json");
const Discord = require("discord.js");
const fs = require("fs");
const client = new Discord.Client({partials: ['MESSAGE', 'CHANNEL', 'REACTION']});

//File storage (TODO: Make this work on a database instead of a JSON file)
//I'm hedging my bets that this file won't get too complicated, hence the constant read+writes
function wasMessageTweeted(guildId, messageId) {
    if (!fs.existsSync(config.datafile)) {
        return false;
    }

    let rawdata = fs.readFileSync(config.datafile);
    let parsed = JSON.parse(rawdata);

    if (!(guildId in parsed.guilds)) {
        return false;
    }

    var guild = parsed.guilds[guildId];

    if (!("messages" in guild)) {
        return false;
    }

    return guild.messages.includes(messageId);
}

function storeMessageTweeted(guildId, messageId) {

    var parsed = {"guilds":{}};

    if (fs.existsSync(config.datafile)) {
        let rawdata = fs.readFileSync(config.datafile);
        parsed = JSON.parse(rawdata);
    }

    if (!(guildId in parsed.guilds)) {
        parsed.guilds[guildId] = {"messages":[messageId]};
    }

    var guild = parsed.guilds[guildId];

    if (!("messages" in guild)) {
        parsed.guilds[guildId].messages = [messageId];
    }

    parsed.guilds[guildId].messages.push(messageId);

    fs.writeFileSync(config.datafile, JSON.stringify(parsed));
}

//Discord Client info
client.once("ready", () => {
    console.log("Connected to Discord");
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch(error) {
            console.log('Something went wrong when fetching the message: ', error);
            return;
        }
    }

    if (reaction.count >= config.reaction_count) {
        console.log("Message hit threshold.");

        var message = reaction.message;

        if (!wasMessageTweeted(message.channel.guild.id, message.id)) {
            //Not tweeted already. Go to town.
            console.log("That's a new one");

            console.log("Tweeting: "+message.content);

            var outboundMessage = (await message.channel.send("Hit reaction limit, tweeting: " + message.content));

            console.log(outboundMessage);

            storeMessageTweeted(message.channel.guild.id, message.id);
        } else {
            console.log("Already tweeted, moving along.");
        }
    }
})

client.login(config.token);