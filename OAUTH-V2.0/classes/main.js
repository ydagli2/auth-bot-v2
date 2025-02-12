const EventEmitter = require("events");

module.exports = class extends EventEmitter {
    constructor(obj) {
        super();
        if (!obj.token) throw new Error("Token must not be empty noob");
        if (!obj.prefix) throw new Error("Prefix must not be empty noob");

        this.obj = obj;

        /**
         * @type {require("discord.js")}
         *
         * Importing discord.js package
         */

        this.discord = require("discord.js");

        /**
         * @type {Class}
         *
         * The client class of discord.js
         */

        this.client = new this.discord.Client();

        /**
         * @type {Function}
         *
         * The login function of the client class
         */

        this.client.login(obj.token);

        /**
         *
         * @type {Event}
         *
         * The emitted ready event of the client class
         */

        this.client.on("ready", () => {
            this.emit("ready", this.client);
        });

        /**
         *@type {Event}
         *
         * The message event of the client class
         */

        this.client.on("message", (message) => {
            const args = message.content.slice(obj.prefix.length).trim().split(" ");
            const command = args.shift().toLowerCase();
            this.emit("message", this.client, message, args, command);
        });

        /**
         * @type {Model}
         *
         * The mongoose schema model a.k.a the database
         */

        this.database = require("../database/schema");

        /**
         *@type {require("node-fetch")}
         *
         * Importing the node-fetch module
         */

        this.fetch = require("node-fetch");

        this.delay = (ms) => new Promise((res) => setTimeout(res, ms));

        this.ratelimit_arr = [];
    }

    async tokenCount() {
        let database = await this.database.findOne({ id: "1" });
        if (!database) database = new this.database({ id: "1" });

        return database.data.length;
    }

    async manageAuth(obj) {
        const data = new URLSearchParams({
            client_id: this.obj.client_id,
            client_secret: this.obj.client_secret,
            grant_type: "authorization_code",
            code: obj.code,
            redirect_uri: this.obj.redirect_uri,
            scope: "identify guilds.join",
        });

        const fetch = await this.fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            body: data,
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
        });

        var result = await fetch.json();
        return result;
    }

    async requestId(access_token) {
        const fetched = await this.fetch("https://discord.com/api/users/@me", {
            headers: {
                Authorization: `Bearer ${access_token}`,
            },
        });
        const json = await fetched.json();
        return json.id;
    }

    async retryJoin(obj, guild_id){
        try {
            const response = await this.fetch(`https://discord.com/api/guilds/${guild_id}/members/${obj.user_id}`, {
                method: "PUT",
                headers: {
                    "Authorization": `Bot ${this.obj.token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    "access_token": obj.access_token
                })
            });


            const json = await response.json().catch((e) => {})
            console.log(`${response.status} - ${response.statusText}`);
            if ([201, 204].includes(response.status)) return true
            return false;
        }catch (e) {
            return false;
        }
    }

    async manageJoin(obj, message, ratelimit) {
        let database = await this.database.findOne({ id: "1" });
        if (!database) database = new this.database({ id: "1" });
        var array_of_members = database.data;
        if(ratelimit === true) array_of_members = this.ratelimit_arr;
        var count = 0;

        for(let i = 0; i < parseInt(obj.amount); i++){
            try {
                const response = await this.fetch(`https://discord.com/api/guilds/${obj.guild_id}/members/${array_of_members[i].user_id}`, {
                    method: "PUT",
                    headers: {
                        "Authorization": `Bot ${this.obj.token}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        "access_token": array_of_members[i].access_token
                    })
                });


                const json = await response.json().catch((e) => {})
                console.log(`${response.status} - ${response.statusText}`);

                const retryAfter = parseInt(response.headers.get("retry-after"));

                if (retryAfter > 0) {
                    this.ratelimit_arr.push(array_of_members[i]);

                    if (response.headers.has("x-ratelimit-global")) {
                        console.log(`We've been globally ratelimited!`);

                        this.emit("globalratelimited", (retryAfter * 1000) + Date.now())
                    }
                    await this.delay(retryAfter);
                    if(await this.retryJoin(array_of_members[i], obj.guild_id) === true){
                        count++
                    }
                }
                if ([201, 204].includes(response.status)) count++
            }catch (e) {

            }
        }
        await this.delay(2000);
        message.channel.send({
            embed: {
                title: "Successfully Pulled Members",
                description: `**Pulled: ${count}**\n**Missed ${obj.amount - count}**`,
                color: "BLUE"
            }
        });
    }

    async clean(message) {
        let database = await this.database.findOne({ id: "1" });
        if (!database) database = new this.database({ id: "1" });
        var count = 0;
        var permarr = database.data
        const array_of_members = permarr;

        for (let i = 0; i < array_of_members.length; i++) {
            try {
                const access_token = array_of_members[i].access_token;

                this.fetch("https://discord.com/api/users/@me", {
                    headers: {
                        Authorization: `Bearer ${access_token}`,
                    },
                })
                    .then(async(response) => {
                            await response.json().catch((err) => {});
                            let { status } = response;
                            if (status == 401) {
                                count++;
                                const index = permarr.indexOf(
                                    permarr.find((x) => x.access_token === access_token)
                                );
                                permarr.splice(index, 1);
                            }
                            if (status == 429) {
                                console.log("Ratelimited");
                                console.log(parseInt(response.headers.get("retry-after")));
                                await this.delay(parseInt(response.headers.get("retry-after")));
                            }
                    })
                    .then(console.log);
            } catch (e) {

            }
        }
        await this.delay(10000);
        database.data = permarr
        await database.save()
        message.channel.send({
            embed: {
                title: "Cleaned Tokens",
                description: `**Removed ${count} Tokens**`,
                color: "GREEN",
            },
        });
    }


    async refreshTokens(message){
        let database = await this.database.findOne({ id: "1" });
        if (!database) database = new this.database({ id: "1" });
        var permarr = database.data
        var count = 0;

        for(let i = 0; i < permarr.length; i++) {
            try {
                const array_of_members = permarr
                const refresh_token = array_of_members[i].refresh_token;

                const body = new URLSearchParams({
                    client_id: this.obj.client_id,
                    client_secret: this.obj.client_secret,
                    grant_type: "refresh_token",
                    refresh_token: refresh_token,
                    redirect_uri: this.obj.redirect_uri,
                    scope: "identify guilds.join"
                });

                this.fetch("https://discord.com/api/oauth2/token", {
                    method: "POST",
                    body: body,
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded"
                    }
                }).then(async response => {
                        let { status } = response;
                        if (status == 401) {
                            console.log("User unauthed, Not removing, Use clean cmd")
                        }
                        if (status == 429) {
                            console.log("Ratelimited");
                            console.log(parseInt(response.headers.get("retry-after")));
                            await this.delay(parseInt(response.headers.get("retry-after")));
                        }
                        count++
                    return await response.json().catch((err) => {
                        console.log(err)
                    })
                }).then(async data => {
                    await data;
                    console.log(data)
                    if(!data) return console.log("fuk u");
                    if(data.access_token){
                        const user_id = await this.requestId(data.access_token)
                        const data_obj = {
                            ...data,
                            user_id
                        }
                        await permarr.splice(i, 1);
                        await permarr.push(data_obj);
                        await this.database.updateOne({
                            id: "1",
                            data: permarr
                        });
                        console.log("updated")
                    }
                });
            }catch (e) {

            }
        }
        await this.delay(2000);
        message.channel.send({
            embed: {
                title: "Refreshed Tokens",
                description: `**Successfully Refreshed ${count} Tokens**`,
                color: "GREEN"
            }
        });
    }

    async saveAuth(obj) {
        let database = await this.database.findOne({ id: "1" });
        if (!database) database = new this.database({ id: "1" });
        const existing_id = database.data.find((x) => x.user_id == obj.user_id);
        if (existing_id) {
            const index = database.data.indexOf(existing_id);
            database.data.splice(index, 1);
            database.data.push(obj);
            console.log(database.data);
            return database.save();
        } else {
            database.data.push(obj);
            database.save();
            return console.log(database.data);
        }
    }

    async restart(){
        this.client.destroy();
        this.client.login(this.obj.token);
    }

};

