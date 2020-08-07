const config = require("./config.json");
const Discord = require("discord.js");
const Twit = require("twit");
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


function formatDate(date) {
    var hours = date.getHours();
    var minutes = date.getMinutes();
    var ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    minutes = minutes < 10 ? '0'+minutes : minutes;
    var strTime = hours + ':' + minutes + ' ' + ampm;
    return (date.getMonth()+1) + "/" + date.getDate() + "/" + date.getFullYear() + "  " + strTime;
  }

//Queueing functionality
function checkQueue() {
    var queue = readQueue();

    var currentTime = new Date();
    
    for (var message of queue.messages) {
        if (message.post_time < currentTime && !message.posted && !message.blocked) {
            tweet(message.content);

            message.posted = true;
        }
    }

    fs.writeFileSync(config.queuefile, JSON.stringify(queue));
}


var queueInterval = setInterval(checkQueue, 1000);

function readQueue() {
    var parsed = {"messages":[]}

    if (fs.existsSync(config.queuefile)) {
        let rawdata = fs.readFileSync(config.queuefile);
        parsed = JSON.parse(rawdata);
    }

    return parsed;
}

function addToQueue(message, outboundMessage) {
    // console.log(outboundMessage);
    var queue = readQueue();

    var t = new Date();

    var newMessage = {
        "content" : message,
        "post_time" : t.setSeconds(t.getSeconds() + config.waitperiod),
        "posted" : false,
        "blocked" : false,
        "stopId" : outboundMessage.id,
        "stopChannelId" : outboundMessage.channel.id,
        "stopGuildId" : outboundMessage.channel.guild.id
    };

    queue.messages.push(newMessage);

    fs.writeFileSync(config.queuefile, JSON.stringify(queue));
}

function isStopMessage(messageId) {
    var queue = readQueue();

    for (var message of queue.messages) {
        if (message.stopId == messageId) {
            return true;
        }
    }

    return false;
}

function blockTweet(stopMessageId) {
    var queue = readQueue();

    for (var message of queue.messages) {
        if (message.stopId == stopMessageId) {
            message.blocked = true;

            notifyOfBlock(message);
        }
    }

    fs.writeFileSync(config.queuefile, JSON.stringify(queue));
}

function notifyOfBlock(message) {
    client.channels.fetch(message.stopChannelId).then(channel => {
        channel.messages.fetch(message.stopId).then(message => {
            var content = message.content;
            message.edit("***Blocked, not Tweeting.***\n" + content);
        }).catch(err => {
            console.log(err);
        })
    }).catch(err => {
        console.log(err);
    })
}

//censoring
function censorMessage(content) { 
    //create a string for a regex to read from the config data
    var searchText = config.censored_words.join("|");
    var regEx = new RegExp(searchText, "ig");

    return content.replace(regEx, "█████");
}

//Twitter functionality
var T = new Twit({
    consumer_key: config.twitter.api_key,
    consumer_secret: config.twitter.api_secret_key,
    access_token: config.twitter.access_token,
    access_token_secret : config.twitter.access_token_secret,
    timeout_ms: 60*1000
});

function tweet(message) { 
    T.post('statuses/update', { status: message }, function(err, data, response) {
        console.log(data);
    })
}



//Discord functionality
client.once("ready", () => {
    console.log("Connected to Discord");
});


client.on('messageReactionAdd', async (reaction, user) => {
    //If the data about this reaction is not loaded, fetch the information before continuing.
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch(error) {
            console.log('Something went wrong when fetching the message: ', error);
            return;
        }
    }

    var message = reaction.message;


    //If it's a bot's message, don't tweet it out. If it's a stop message, stop that tweet from happening.
    if (message.author.bot) {
        if (isStopMessage(message.id)) {
            //It's a stop message. Make sure it's the "Stop" reaction and veto the release.
            if (reaction.count > 1 && reaction.emoji.name==config.stopemoji) {
                blockTweet(message.id);
            }
        }

        return;
    }

    if (reaction.count >= config.reaction_count) {
        
        if (!wasMessageTweeted(message.channel.guild.id, message.id)) {
            //Not tweeted already. Go to town.
            var content = censorMessage(message.content);

            console.log("Preparing to tweet:")
            console.log(content);

            if (content.length > 240) {
                message.channel.send("Message too long to tweet: " + content);
                return;
            }

            var postDate = new Date();
            postDate.setSeconds(postDate.getSeconds() + config.waitperiod);


            var outboundMessage = (await message.channel.send("Popular message you got there. Tweeting at " + formatDate(postDate) + "\n> " + content + "\nReact with "+config.stopemoji+" to block this from being tweeted."));

            outboundMessage.react(config.stopemoji);

            storeMessageTweeted(message.channel.guild.id, message.id);

            addToQueue(content, outboundMessage);
        } else {
            console.log("Already tweeted, moving along.");
        }
    }
})

client.login(config.token);