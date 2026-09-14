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
      const { Client } = await import('archipelago.js');

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

  async _handleDisconnect({ notifyDiscord }) {
    if (this._disconnectHandled) return;

    this._disconnectHandled = true;
    this._status = 'disconnected';

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
      const message = reconstructed || `**${player.alias}** completed their game!`;
      void this._sendDiscordMessage(message);
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
