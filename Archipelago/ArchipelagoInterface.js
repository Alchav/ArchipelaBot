// ArchipelagoInterface.js — CommonJS wrapper for archipelago.js (ESM)

//
// NOTE: DO NOT USE require("archipelago.js") — it is ESM only.
//       We load it via dynamic import() inside async _init().
//

class ArchipelagoInterface {
  constructor(discordChannel, server, port, slotName, password, options = {}) {
    this.discordChannel = discordChannel;
    this.server = server;
    this.port = port;
    this.slotName = slotName;
    this.password = password ?? '';
    this._onDisconnect = options.onDisconnect ?? null;

    // Visibility toggles
    this.showChat = false;
    this.showHints = false;
    this.showItems = true;
    this.showProgression = true;

    this.players = new Map();

    this._status = 'connecting';
    this._client = null;
    this._hasAuthenticated = false;
    this._manualDisconnect = false;
    this._disconnectHandled = false;
    this._completedPlayers = new Set();
    this._goalStatusesInitialized = false;
    this._goalPollInterval = null;
    this._goalPollInProgress = false;

    this._init();
  }

  // Convert AP node arrays → a human-readable message exactly like pre-2.0 bots
  _buildMessage(nodes) {
    if (!Array.isArray(nodes)) return '';

    let msg = '';

    for (const node of nodes) {
      msg += node.text ?? '';
    }

    return msg.trim();
  }

  async _init() {
    try {
      // Load the ESM module archipelago.js
      const { Client, clientStatuses, slotTypes } = await import('archipelago.js');

      this._client = new Client({
        timeout: 10000,
        autoFetchDataPackage: true,
        maximumMessages: 500,
        debugLogVersions: false,
      });

      const url = `wss://${this.server}:${this.port}`;

      this._client
        .login(url, this.slotName, '', {
          password: this.password,
          tags: ['AP', 'DiscordBot'],
        })
        .then(() => {
          if (this._disconnectHandled) return;
          this._hasAuthenticated = true;
          this._status = 'authenticated';
          this._startGoalStatusPolling(clientStatuses.goal, slotTypes.player);
        })
        .catch((err) => {
          if (this._disconnectHandled) return;
          console.error('[AP] Login failed:', err);
          this._status = 'error';
        });

      this._registerEvents();
    } catch (err) {
      console.error('[AP] Failed to initialize:', err);
      this._status = 'error';
    }
  }

  async _sendDiscordMessage(message) {
    try {
      await this.discordChannel.send(message);
    } catch (err) {
      console.error('[AP] Failed to send Discord message:', err);
    }
  }

  _playerKey(player) {
    return `${player.team}:${player.slot}`;
  }

  async _announceGoal(player, message = null) {
    const playerKey = this._playerKey(player);
    if (this._completedPlayers.has(playerKey)) return;

    this._completedPlayers.add(playerKey);
    await this._sendDiscordMessage(
      message || `**${player.alias}** completed their game!`
    );
  }

  _startGoalStatusPolling(goalStatus, playerSlotType) {
    const poll = async () => {
      if (this._goalPollInProgress || !this._client?.authenticated) return;
      this._goalPollInProgress = true;

      try {
        const players = this._client.players.teams
          .flat()
          .filter(player => player.slot > 0 && player.type === playerSlotType);
        const playersByStatusKey = new Map(
          players.map(player => [
            `_read_client_status_${player.team}_${player.slot}`,
            player,
          ])
        );
        const statuses = await this._client.storage.fetch(
          Array.from(playersByStatusKey.keys())
        );

        for (const [statusKey, player] of playersByStatusKey) {
          if (statuses[statusKey] === goalStatus) {
            if (this._goalStatusesInitialized) {
              await this._announceGoal(player);
            } else {
              this._completedPlayers.add(this._playerKey(player));
            }
          }
        }

        this._goalStatusesInitialized = true;
      } catch (err) {
        console.error('[AP] Failed to check player completion statuses:', err);
      } finally {
        this._goalPollInProgress = false;
      }
    };

    void poll();
    this._goalPollInterval = setInterval(poll, 10000);
    this._goalPollInterval.unref?.();
  }

  async _handleDisconnect({ notifyDiscord }) {
    if (this._disconnectHandled) return;

    this._disconnectHandled = true;
    this._status = 'disconnected';

    if (this._goalPollInterval) {
      clearInterval(this._goalPollInterval);
      this._goalPollInterval = null;
    }

    if (typeof this._onDisconnect === 'function') {
      try {
        this._onDisconnect(this);
      } catch (err) {
        console.error('[AP] Disconnect cleanup error:', err);
      }
    }

    if (notifyDiscord && this._hasAuthenticated) {
      await this._sendDiscordMessage(
        `Lost connection to Archipelago server **${this.server}:${this.port}** for slot **${this.slotName}**.`
      );
    }
  }

  _registerEvents() {
    if (!this._client) return;

    //
    // Socket status
    //
    this._client.socket.on('connected', () => {
      console.log('[AP] Socket connected.');
    });

    this._client.socket.on('disconnected', () => {
      console.log('[AP] Socket disconnected.');
      void this._handleDisconnect({ notifyDiscord: !this._manualDisconnect });
    });

    //
    // Chat
    //
    this._client.messages.on('chat', (message, player, nodes) => {
      const reconstructed = this._buildMessage(nodes);
      console.log('[CHAT RAW]', { message, player, nodes, reconstructed });
      if (this.showChat && reconstructed) this.discordChannel.send(reconstructed);
    });

    //
    // Game completed
    //
    this._client.messages.on('goaled', (text, player, nodes) => {
      const reconstructed = this._buildMessage(nodes);
      void this._announceGoal(player, reconstructed);
    });

    //
    // Item sent
    //
    this._client.messages.on('itemSent', (text, item, nodes) => {
      const reconstructed = this._buildMessage(nodes);
      if (!reconstructed) return;

      const isProgression = item.flags & 1;
      const isUseful = item.flags & 2;

      if (isProgression || isUseful) {
        // show only progression OR useful
        this.discordChannel.send(reconstructed);
      }
    });

    //
    // Hint
    //
    this._client.messages.on('itemHinted', (text, item, found, nodes) => {
      const reconstructed = this._buildMessage(nodes);
      if (this.showHints && reconstructed) this.discordChannel.send(reconstructed);
    });
  }

  //
  // Player alias management (unchanged)
  //
  setPlayer(alias, user) {
    this.players.set(alias, user);
  }

  unsetPlayer(alias) {
    this.players.delete(alias);
  }

  //
  // Bot status
  //
  getStatus() {
    return this._status;
  }

  //
  // Disconnect cleanly
  //
  disconnect() {
    this._manualDisconnect = true;
    void this._handleDisconnect({ notifyDiscord: false });

    try {
      if (this._client) {
        this._client.socket.disconnect();
      }
    } catch (err) {
      console.error('[AP] Disconnect error:', err);
    }
  }
}

module.exports = ArchipelagoInterface;
