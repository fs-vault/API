const router = require('express').Router();
const session = require('express-session');
const axios = require('axios');
const qs = require('qs');
const redis = require("redis");
const client = redis.createClient(process.env.REDIS);
const db = require('../../models');
const Player = require('../../models/player.js')(db.sequelize, db.DataTypes);

router.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}))

// TODO detection if you are already linked

router.get('/auth', (req, res) => {
    let code = req.query.code, token = req.session.token

    if (!code || !token) {
      return res.status(400).json({message: 'Bad Request.'})
    }

    // Fetch a Discord access token, the player's Discord id, and their Minecraft UUID
    let getUserData = async () => {
      let accessToken = await axios.post('https://discord.com/api/v6/oauth2/token', qs.stringify({
        client_id: '619754624257228800',
        client_secret: process.env.CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: 'https://api.firestartermc.com/verify/auth',
        scope: 'identify guilds.join'
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }).then(response => {
        return response.data.access_token
      })

      let discordId = await axios.get('https://discordapp.com/api/users/@me', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }).then(response => {
        return response.data.id
      })

      let uuid = await client.hget('discord', token, (err, uuid) => {
        if (!uuid || err) throw err ? err : 'Invalid token provided.'
        else return uuid
      })
    
      return [accessToken, discordId, uuid]
    }

    getUserData()
      .then((data) => {
        let [accessToken, discordId, uuid] = data

        Player.update({discord: discordId}, {
          where: {uuid}
        })
        .then(() => {
          req.session.destroy
          return client.hdel('discord', token)
        })
        .then(() => {
          return axios.put(`https://discordapp.com/api/guilds/609452308161363995/members/${discordId}`, {
            'access_token': accessToken
          }, {
            headers: {
              'Authorization': `Bot ${process.env.BOT_TOKEN}`,
              'Content-Type': 'application/json'
            }
          })
        })
        .then((response) => {
          if (response.status === 204) {
            res.status(200).send('Your Discord account has been linked. You may now close this window.')
          } else {
            res.status(200).send('You\'ve been added to the Discord server and your account has been linked. ' +
              'You may now close this window.')
          }
        })
      })
      .catch(err => {
        console.error(err);
        res.status(500).send('Failed to verify your Discord account.')
      })
});

router.get('/:token', (req, res) => {
    client.hget("discord", req.params.token, (err, result) => {
        if (err) {
            res.status(500).json({message: 'Internal Server Error.'})
        } else {
            if (!result) {
              res.status(400).json({message: "Bad Request."})
            } else {
                req.session.token = req.params.token;
                res.redirect(process.env.OAUTH_REDIRECT)
            }
        }
    });
});

module.exports = router;
