// slashCommandCategories/archipelago.js — CommonJS

const { SlashCommandBuilder } = require("discord.js");
const { AsciiTable3, AlignmentEnum } = require("ascii-table3");

// Lazy-loaded pointer to ArchipelagoInterface (ESM)
let ArchipelagoInterface = null;

async function loadAPInterface() {
  if (!ArchipelagoInterface) {
    const imported = await import("../Archipelago/ArchipelagoInterface.js");
    ArchipelagoInterface = imported.default || imported;
  }
  return ArchipelagoInterface;
}

module.exports = {
  category: "Archipelago",
  commands: [
    // -----------------------------------------
    // /ap-connect
    // -----------------------------------------
    {
      commandBuilder: new SlashCommandBuilder()
        .setName("ap-connect")
        .setDescription("Begin monitoring an Archipelago game in this channel.")
        .setDMPermission(false)
        .addStringOption(opt =>
          opt
            .setName("server-address")
            .setDescription("Server address (ex: archipelago.gg)")
            .setRequired(false)
        )
        .addNumberOption(opt =>
          opt
            .setName("port")
            .setDescription("Port number your game is on")
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt
            .setName("slot-name")
            .setDescription("Slot name from your AP config")
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt
            .setName("password")
            .setDescription("Password for the AP server, if needed")
            .setRequired(false)
        ),

      async execute(interaction) {
        await loadAPInterface();

        const serverAddress =
          interaction.options.getString("server-address") ??
          "ap.jalchavware.com";
        const port = interaction.options.getNumber("port") ?? 38281;
        const slotName =
          interaction.options.getString("slot-name") ?? "AlchapelaBot";
        const password = interaction.options.getString("password") ?? null;

        // Already monitoring?
        if (interaction.client.tempData.apInterfaces.has(interaction.channel.id)) {
          return interaction.reply({
            content:
              "This channel is already monitoring an Archipelago game. Disconnect first.",
            ephemeral: true,
          });
        }

        await interaction.deferReply({ ephemeral: false });

        // Create connection instance
        const APInterface = new ArchipelagoInterface(
          interaction.channel,
          serverAddress,
          port,
          slotName,
          password
        );

        // Poll status for up to 5 seconds
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 500));

          if (APInterface.getStatus() === "authenticated") {
            interaction.client.tempData.apInterfaces.set(
              interaction.channel.id,
              APInterface
            );

            return interaction.editReply(
              `Connected to **${serverAddress}** as slot **${slotName}**.`
            );
          }
        }

        // Failure
        await interaction.editReply(
          `Unable to connect to Archipelago server at **${serverAddress}**.`
        );
      },
    },

    // -----------------------------------------
    // /ap-disconnect
    // -----------------------------------------
    {
      commandBuilder: new SlashCommandBuilder()
        .setName("ap-disconnect")
        .setDescription("Stop monitoring the current Archipelago game.")
        .setDMPermission(false),

      async execute(interaction) {
        const bucket = interaction.client.tempData.apInterfaces;

        if (!bucket.has(interaction.channel.id)) {
          return interaction.reply({
            content: "This channel is not monitoring any Archipelago game.",
            ephemeral: true,
          });
        }

        bucket.get(interaction.channel.id).disconnect();
        bucket.delete(interaction.channel.id);

        return interaction.reply("Disconnected from Archipelago game.");
      },
    },

    // -----------------------------------------
    // /ap-set-alias
    // -----------------------------------------
    {
      commandBuilder: new SlashCommandBuilder()
        .setName("ap-set-alias")
        .setDescription("Associate your Discord user with an alias.")
        .addStringOption(opt =>
          opt.setName("alias").setDescription("Alias").setRequired(true)
        )
        .setDMPermission(false),

      async execute(interaction) {
        const alias = interaction.options.getString("alias");

        const ap = interaction.client.tempData.apInterfaces.get(
          interaction.channel.id
        );
        if (!ap) {
          return interaction.reply({
            content: "No Archipelago game is being monitored here.",
            ephemeral: true,
          });
        }

        ap.setPlayer(alias, interaction.user);

        return interaction.reply(
          `Associated **${interaction.user}** with alias **${alias}**.`
        );
      },
    },

    // -----------------------------------------
    // /ap-unset-alias
    // -----------------------------------------
    {
      commandBuilder: new SlashCommandBuilder()
        .setName("ap-unset-alias")
        .setDescription("Remove an alias association.")
        .addStringOption(opt =>
          opt.setName("alias").setDescription("Alias").setRequired(true)
        )
        .setDMPermission(false),

      async execute(interaction) {
        const alias = interaction.options.getString("alias");

        const ap = interaction.client.tempData.apInterfaces.get(
          interaction.channel.id
        );
        if (!ap) {
          return interaction.reply({
            content: "No Archipelago game is being monitored here.",
            ephemeral: true,
          });
        }

        if (!ap.players.has(alias)) {
          return interaction.reply(`Alias **${alias}** is not assigned.`);
        }

        if (ap.players.get(alias) !== interaction.user) {
          return interaction.reply(
            "Only the user assigned to this alias may remove it."
          );
        }

        ap.unsetPlayer(alias);
        return interaction.reply(
          `Alias **${alias}** has been unassigned from ${interaction.user}.`
        );
      },
    },

    // -----------------------------------------
    // /ap-list-aliases
    // -----------------------------------------
    {
      commandBuilder: new SlashCommandBuilder()
        .setName("ap-list-aliases")
        .setDescription("Show the list of aliases for this channel's AP game.")
        .setDMPermission(false),

      async execute(interaction) {
        const ap = interaction.client.tempData.apInterfaces.get(
          interaction.channel.id
        );
        if (!ap) {
          return interaction.reply({
            content: "No Archipelago game is being monitored here.",
            ephemeral: true,
          });
        }

        if (ap.players.size === 0) {
          return interaction.reply("No aliases are assigned.");
        }

        const table = new AsciiTable3()
          .setHeading("Player", "Alias")
          .addRowMatrix(
            Array.from(ap.players, ([alias, user]) => [
              user.displayName || user.username,
              alias,
            ])
          )
          .setAlign(1, AlignmentEnum.LEFT)
          .setAlign(2, AlignmentEnum.RIGHT)
          .setStyle("compact");

        return interaction.reply(`\`\`\`${table.toString()}\`\`\``);
      },
    },

    // -----------------------------------------
    // SHOW/HIDE COMMANDS
    // -----------------------------------------

    {
      commandBuilder: new SlashCommandBuilder()
        .setName("ap-show-chat")
        .setDescription("Show chat messages from AP.")
        .setDMPermission(false),
      async execute(interaction) {
        const ap = interaction.client.tempData.apInterfaces.get(
          interaction.channel.id
        );
        if (!ap)
          return interaction.reply({
            content: "No AP game monitored here.",
            ephemeral: true,
          });

        ap.showChat = true;
        return interaction.reply("Chat messages are now visible.");
      },
    },

    {
      commandBuilder: new SlashCommandBuilder()
        .setName("ap-hide-chat")
        .setDescription("Hide chat messages from AP.")
        .setDMPermission(false),
      async execute(interaction) {
        const ap = interaction.client.tempData.apInterfaces.get(
          interaction.channel.id
        );
        if (!ap)
          return interaction.reply({
            content: "No AP game monitored here.",
            ephemeral: true,
          });

        ap.showChat = false;
        return interaction.reply("Chat messages will be hidden.");
      },
    },

    {
      commandBuilder: new SlashCommandBuilder()
        .setName("ap-show-hints")
        .setDescription("Show hint messages.")
        .setDMPermission(false),
      async execute(interaction) {
        const ap = interaction.client.tempData.apInterfaces.get(
          interaction.channel.id
        );
        if (!ap)
          return interaction.reply({
            content: "No AP game monitored here.",
            ephemeral: true,
          });

        ap.showHints = true;
        return interaction.reply("Hints are now visible.");
      },
    },

    {
      commandBuilder: new SlashCommandBuilder()
        .setName("ap-hide-hints")
        .setDescription("Hide hint messages.")
        .setDMPermission(false),
      async execute(interaction) {
        const ap = interaction.client.tempData.apInterfaces.get(
          interaction.channel.id
        );
        if (!ap)
          return interaction.reply({
            content: "No AP game monitored here.",
            ephemeral: true,
          });

        ap.showHints = false;
        return interaction.reply("Hints will be hidden.");
      },
    },

    {
      commandBuilder: new SlashCommandBuilder()
        .setName("ap-show-progression")
        .setDescription("Show only progression items.")
        .setDMPermission(false),
      async execute(interaction) {
        const ap = interaction.client.tempData.apInterfaces.get(
          interaction.channel.id
        );
        if (!ap)
          return interaction.reply({
            content: "No AP game monitored here.",
            ephemeral: true,
          });

        ap.showItems = false;
        ap.showProgression = true;

        return interaction.reply("Showing progression items only.");
      },
    },

    {
      commandBuilder: new SlashCommandBuilder()
        .setName("ap-show-items")
        .setDescription("Show all item messages.")
        .setDMPermission(false),
      async execute(interaction) {
        const ap = interaction.client.tempData.apInterfaces.get(
          interaction.channel.id
        );
        if (!ap)
          return interaction.reply({
            content: "No AP game monitored here.",
            ephemeral: true,
          });

        ap.showItems = true;
        ap.showProgression = true;

        return interaction.reply("Showing all item messages.");
      },
    },

    {
      commandBuilder: new SlashCommandBuilder()
        .setName("ap-hide-items")
        .setDescription("Hide all item messages.")
        .setDMPermission(false),
      async execute(interaction) {
        const ap = interaction.client.tempData.apInterfaces.get(
          interaction.channel.id
        );
        if (!ap)
          return interaction.reply({
            content: "No AP game monitored here.",
            ephemeral: true,
          });

        ap.showItems = false;
        ap.showProgression = false;

        return interaction.reply("Hiding all item messages.");
      },
    },
  ],
};
