const express = require('express');
const mineflayer = require('mineflayer');
const path = require('path');
const { Vec3 } = require('vec3');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

class BotManager {
  constructor() {
    this.bots = [];
  }

  createBot(username, host, port, proxy = null) {
    const botOptions = {
      host,
      port,
      username,
      autoReconnect: false
    };

    if (proxy) {
      botOptions.connect = (client) => {
        const { SocksClient } = require('socks');
        SocksClient.createConnection({
          proxy: { host: proxy.host, port: proxy.port, type: proxy.type },
          command: 'connect',
          destination: { host, port }
        }, (err, info) => {
          if (err) {
            console.error(`${username} proxy connection error:`, err);
            return;
          }
          client.setSocket(info.socket);
          client.emit('connect');
        });
      };
    }

    const bot = mineflayer.createBot(botOptions);

    const spawnTimeout = setTimeout(() => {
      if (!bot.entity) {
        console.error(`Bot ${username} did not spawn. The IP or port connection may have failed.`);
      }
    }, 10000);
    bot.once('spawn', () => clearTimeout(spawnTimeout));

    bot.on('login', () => console.log(`${username} logged in successfully.`));
    bot.on('spawn', () => console.log(`${username} spawned in the game.`));
    bot.on('chat', (usr, message) => {
      if (usr !== bot.username) {
        console.log(`${usr}: ${message}`);
      }
    });
    bot.on('end', (reason) => {
      console.log(`${username} disconnected from the server: ${reason}`);
      this.bots = this.bots.filter(b => b !== bot);
    });
    bot.on('error', (err) => {
      console.error(`${username} error:`, err);
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        console.error(`Bot ${username} failed the IP/port connection. Please check.`);
      }
    });

    bot.protectHandler = null;
    bot.protectAttackHandler = null;
    bot.attackHandler = null;
    bot.circleMovementHandler = null;
    bot.squareMovementHandler = null;
    bot.rectangleMovementHandler = null;
    bot.squarePath = null;
    bot.rectanglePath = null;

    this.bots.push(bot);
    return bot;
  }

  sendMessageToAllBots(message) {
    this.bots.forEach(bot => bot.chat(message));
  }

  async killAllBots() {
    const closePromises = this.bots.map(bot => this.closeBot(bot));
    await Promise.all(closePromises);
    this.bots = [];
  }

  closeBot(bot) {
    return new Promise((resolve) => {
      try {
        bot.removeAllListeners();
        bot.clearControlStates();
        console.log(`Bot ${bot.username} shutdown process started...`);
        bot.quit();
        setTimeout(() => {
          if (bot._client && !bot._client.destroyed) {
            try {
              if (bot._client.socket) {
                if (typeof bot._client.socket.end === 'function') {
                  bot._client.socket.end();
                }
                if (typeof bot._client.socket.destroy === 'function') {
                  bot._client.socket.destroy();
                  console.log(`Bot ${bot.username} forcibly shutdown via _client.socket (one time).`);
                }
              } else {
                if (typeof bot._client.end === 'function') {
                  bot._client.end();
                }
                if (typeof bot._client.destroy === 'function') {
                  bot._client.destroy();
                  console.log(`Bot ${bot.username} forcibly shutdown via _client (one time).`);
                }
              }
            } catch (err) {
              console.error(`Bot ${bot.username} force shutdown error:`, err);
            }
          }
          console.log(`Bot ${bot.username} shutdown process completed (one time).`);
          resolve();
        }, 1000);
      } catch (err) {
        console.error(`Bot ${bot.username} shutdown error:`, err);
        resolve();
      }
    });
  }

  suicideAllBots() {
    this.bots.forEach(bot => bot.chat('/kill'));
  }

  moveAllBots(direction) {
    this.bots.forEach(bot => bot.setControlState(direction, true));
  }

  stopAllBots(direction) {
    this.bots.forEach(bot => bot.setControlState(direction, false));
  }

  moveInCircle(bot, radius = 5) {
    if (bot.circleMovementHandler) {
      bot.removeListener('physicsTick', bot.circleMovementHandler);
    }
    let angle = 0;
    const handler = () => {
      angle += 0.1;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      bot.lookAt(new Vec3(bot.entity.position.x + x, bot.entity.position.y, bot.entity.position.z + z));
      bot.setControlState('forward', true);
    };
    bot.circleMovementHandler = handler;
    bot.on('physicsTick', handler);
  }

  moveInSquare(bot, sideLength = 10) {
    if (bot.squareMovementHandler) {
      bot.removeListener('physicsTick', bot.squareMovementHandler);
      bot.squareMovementHandler = null;
      bot.squarePath = null;
    }
    let step = 0;
    const init = bot.entity.position.clone();
    const path = [
      { x: init.x + sideLength, z: init.z },
      { x: init.x + sideLength, z: init.z + sideLength },
      { x: init.x, z: init.z + sideLength },
      { x: init.x, z: init.z }
    ];
    bot.squarePath = path;
    const handler = () => {
      const currentTarget = bot.squarePath[step % bot.squarePath.length];
      bot.lookAt(new Vec3(currentTarget.x, bot.entity.position.y, currentTarget.z));
      bot.setControlState('forward', true);
      const dx = bot.entity.position.x - currentTarget.x;
      const dz = bot.entity.position.z - currentTarget.z;
      if (Math.sqrt(dx * dx + dz * dz) < 1) {
        step++;
      }
    };
    bot.squareMovementHandler = handler;
    bot.on('physicsTick', handler);
  }

  moveInRectangle(bot, width = 10, height = 5) {
    if (bot.rectangleMovementHandler) {
      bot.removeListener('physicsTick', bot.rectangleMovementHandler);
      bot.rectangleMovementHandler = null;
      bot.rectanglePath = null;
    }
    let step = 0;
    const init = bot.entity.position.clone();
    const path = [
      { x: init.x + width, z: init.z },
      { x: init.x + width, z: init.z + height },
      { x: init.x, z: init.z + height },
      { x: init.x, z: init.z }
    ];
    bot.rectanglePath = path;
    const handler = () => {
      const currentTarget = bot.rectanglePath[step % bot.rectanglePath.length];
      bot.lookAt(new Vec3(currentTarget.x, bot.entity.position.y, currentTarget.z));
      bot.setControlState('forward', true);
      const dx = bot.entity.position.x - currentTarget.x;
      const dz = bot.entity.position.z - currentTarget.z;
      if (Math.sqrt(dx * dx + dz * dz) < 1) {
        step++;
      }
    };
    bot.rectangleMovementHandler = handler;
    bot.on('physicsTick', handler);
  }

  stopMovementForBot(bot) {
    if (bot.circleMovementHandler) {
      bot.removeListener('physicsTick', bot.circleMovementHandler);
      bot.circleMovementHandler = null;
    }
    if (bot.squareMovementHandler) {
      bot.removeListener('physicsTick', bot.squareMovementHandler);
      bot.squareMovementHandler = null;
      bot.squarePath = null;
    }
    if (bot.rectangleMovementHandler) {
      bot.removeListener('physicsTick', bot.rectangleMovementHandler);
      bot.rectangleMovementHandler = null;
      bot.rectanglePath = null;
    }
    bot.clearControlStates();
  }

  protectPlayer(bot, targetPlayer) {
    if (bot.protectHandler) {
      bot.removeListener('physicsTick', bot.protectHandler);
    }
    const desiredDistance = 2, margin = 0.5;
    const handler = () => {
      const target = bot.players[targetPlayer]?.entity;
      if (target) {
        const dx = bot.entity.position.x - target.position.x;
        const dz = bot.entity.position.z - target.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        if (distance < desiredDistance - margin) {
          bot.setControlState('back', true);
          bot.setControlState('forward', false);
        } else if (distance > desiredDistance + margin) {
          bot.setControlState('forward', true);
          bot.setControlState('back', false);
        } else {
          bot.setControlState('forward', false);
          bot.setControlState('back', false);
        }
        bot.lookAt(target.position.offset(0, 1.6, 0));
      }
    };
    bot.protectHandler = handler;
    bot.on('physicsTick', handler);

    if (bot.protectAttackHandler) {
      bot.removeListener('physicsTick', bot.protectAttackHandler);
    }
    const hostileTypes = ['zombie', 'creeper', 'spider', 'skeleton'];
    const attackHandler = () => {
      const target = bot.players[targetPlayer]?.entity;
      if (target) {
        for (const id in bot.entities) {
          const entity = bot.entities[id];
          if (!entity) continue;
          const name = entity.name.toLowerCase();
          if (hostileTypes.includes(name) && entity.position.distanceTo(target.position) < 10) {
            bot.attack(entity);
            return;
          }
        }
      }
    };
    bot.protectAttackHandler = attackHandler;
    bot.on('physicsTick', attackHandler);
  }

  attackPlayer(bot, targetPlayer) {
    if (bot.attackHandler) {
      bot.removeListener('physicsTick', bot.attackHandler);
    }
    const handler = () => {
      const target = bot.players[targetPlayer]?.entity;
      if (target) {
        bot.lookAt(target.position.offset(0, 1.6, 0));
        bot.attack(target);
      }
    };
    bot.attackHandler = handler;
    bot.on('physicsTick', handler);
  }

  stopActions() {
    this.bots.forEach(bot => {
      if (bot.protectHandler) {
        bot.removeListener('physicsTick', bot.protectHandler);
        bot.protectHandler = null;
      }
      if (bot.protectAttackHandler) {
        bot.removeListener('physicsTick', bot.protectAttackHandler);
        bot.protectAttackHandler = null;
      }
      if (bot.attackHandler) {
        bot.removeListener('physicsTick', bot.attackHandler);
        bot.attackHandler = null;
      }
      bot.clearControlStates();
    });
  }
}

const botManager = new BotManager();

app.post('/createBots', (req, res) => {
  const botCount = parseInt(req.body.botCount);
  const ip = req.body.ip;
  const port = parseInt(req.body.port);
  const nickname = req.body.nickname;
  const interval = parseInt(req.body.interval);
  const useProxy = req.body.useProxy === 'true';

  for (let i = 1; i <= botCount; i++) {
    const username = nickname === 'random' ? `bot${i}` : `${nickname}${i}`;
    const proxy = useProxy ? { host: 'proxy.example.com', port: 1080, type: 5 } : null;
    setTimeout(() => {
      botManager.createBot(username, ip, port, proxy);
    }, i * interval);
  }
  res.send(`${botCount} bots created.`);
});

app.post('/sendChat', (req, res) => {
  const message = req.body.message;
  botManager.sendMessageToAllBots(message);
  res.send(`Message sent: ${message}`);
});

app.post('/moveBots', (req, res) => {
  const direction = req.body.direction;
  botManager.moveAllBots(direction);
  res.send(`All bots are moving ${direction}.`);
});

app.post('/stopBots', (req, res) => {
  const direction = req.body.direction;
  botManager.stopAllBots(direction);
  res.send(`All bots stopped moving ${direction}.`);
});

app.post('/killBots', async (req, res) => {
  await botManager.killAllBots();
  res.send('All bots have been shut down.');
});

app.post('/suicideBots', (req, res) => {
  botManager.suicideAllBots();
  res.send('All bots have self-destructed.');
});

app.post('/protectPlayer', (req, res) => {
  const targetPlayer = req.body.targetPlayer;
  botManager.bots.forEach(bot => {
    botManager.protectPlayer(bot, targetPlayer);
  });
  res.send(`All bots have started protecting ${targetPlayer}.`);
});

app.post('/attackPlayer', (req, res) => {
  const targetPlayer = req.body.targetPlayer;
  botManager.bots.forEach(bot => {
    botManager.attackPlayer(bot, targetPlayer);
  });
  res.send(`All bots are attacking ${targetPlayer}.`);
});

app.post('/stopActions', (req, res) => {
  botManager.stopActions();
  res.send('All bot actions have been stopped.');
});

app.post('/moveInCircle', (req, res) => {
  botManager.bots.forEach(bot => {
    botManager.moveInCircle(bot);
  });
  res.send('All bots are moving in a circle.');
});

app.post('/moveInSquare', (req, res) => {
  botManager.bots.forEach(bot => {
    botManager.moveInSquare(bot);
  });
  res.send('All bots are moving in a square.');
});

app.post('/moveInRectangle', (req, res) => {
  botManager.bots.forEach(bot => {
    botManager.moveInRectangle(bot);
  });
  res.send('All bots are moving in a rectangle.');
});

app.post('/stopMovement', (req, res) => {
  botManager.bots.forEach(bot => {
    botManager.stopMovementForBot(bot);
  });
  res.send('All movement has been stopped.');
});

app.get('/bots', (req, res) => {
  const botList = botManager.bots.map(bot => bot.username);
  res.json(botList);
});

app.post('/suicideBot', (req, res) => {
  const username = req.body.username;
  const bot = botManager.bots.find(b => b.username === username);
  if (!bot) {
    res.status(404).send(`Bot ${username} not found.`);
    return;
  }
  bot.chat('/kill');
  res.send(`Bot ${username} has self-destructed.`);
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}.`);
});
