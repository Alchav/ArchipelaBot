// ArchipelagoInterface.js — CommonJS wrapper for archipelago.js (ESM)

//
// NOTE: DO NOT USE require("archipelago.js") — it is ESM only.
//       We load it via dynamic import() inside async _init().
//

class ArchipelagoInterface {
  constructor(discordChannel, server, port, slotName, password) {
    this.discordChannel = discordChannel;
    this.server = server;
    this.port = port;
    this.slotName = slotName;
    this.password = password ?? "";

    // Visibility toggles
    this.showChat = false;
    this.showHints = false;
    this.showItems = true;
    this.showProgression = true;

    this.players = new Map();

    this._status = "connecting";
    this._client = null;

    this._init();
  }

  // Convert AP node arrays → a human-readable message exactly like pre-2.0 bots
  _buildMessage(nodes) {
    if (!Array.isArray(nodes)) return "";

    let msg = "";

    for (const node of nodes) {
      msg += node.text ?? "";
    }

    return msg.trim();
  }

  async _init() {
    try {
      // Load the ESM module archipelago.js
      const { Client, clientStatuses } = await import("archipelago.js");

      this._client = new Client({
        timeout: 10000,
        autoFetchDataPackage: true,
        maximumMessages: 500,
        debugLogVersions: false
      });

      const url = `wss://${this.server}:${this.port}`;

      this._client
        .login(url, this.slotName, "", {
          password: this.password,
          tags: ["AP", "DiscordBot"]
        })
        .then(() => {
          this._status = "authenticated";
        })
        .catch((err) => {
          console.error("[AP] Login failed:", err);
          this._status = "error";
        });

      this._registerEvents(clientStatuses);
    } catch (err) {
      console.error("[AP] Failed to initialize:", err);
      this._status = "error";
    }
  }

  _registerEvents(clientStatuses) {
    if (!this._client) return;

    //
    // Socket status
    //
    this._client.socket.on("connected", () => {
      console.log("[AP] Socket connected.");
    });

    this._client.socket.on("disconnected", () => {
      console.log("[AP] Socket disconnected.");
      this._status = "disconnected";
    });

    //
    // Chat
    //
    this._client.messages.on("chat", (message, player, nodes) => {
      const reconstructed = this._buildMessage(nodes);
      console.log("[CHAT RAW]", { message, player, nodes, reconstructed });
      if (this.showChat && reconstructed) this.discordChannel.send(reconstructed);
    });


    //
    // Item sent
    //
    this._client.messages.on("itemSent", (text, item, nodes) => {
      const reconstructed = this._buildMessage(nodes);
      if (!reconstructed) return;

        const isProgression = item.flags & 1;
        const isUseful      = item.flags & 2;

        if (isProgression || isUseful) {
        // show only progression OR useful
            this.discordChannel.send(reconstructed);
        }
    });


    //
    // Hint
    //
    this._client.messages.on("itemHinted", (text, item, found, nodes) => {
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
    try {
      if (this._client) {
        this._client.socket.disconnect();
      }
    } catch (err) {
      console.error("[AP] Disconnect error:", err);
    }
  }
}

module.exports = ArchipelagoInterface;
