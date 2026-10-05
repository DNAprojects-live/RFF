// npm i discord.js
// Env: DISCORD_BOT_TOKEN, DISCORD_ID (Application ID), GUILD_ID, BASE_URL
import {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';

const { DISCORD_BOT_TOKEN, DISCORD_ID, GUILD_ID, BASE_URL } = process.env;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('verify-panel')
    .setDescription('Post the verification panel in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
];

client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
  await rest.put(Routes.applicationGuildCommands(DISCORD_ID, GUILD_ID), { body: commands });
  console.log('Bot is online as', client.user.tag);
});

client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand() || i.commandName !== 'verify-panel') return;

  const embed = new EmbedBuilder()
    .setTitle('Verification')
    .setDescription(
      'Link your accounts to get your role and nickname.\n\n' +
      '**1.** Verify with Discord\n**2.** Verify with Roblox\n\n' +
      'Everything happens on our website and takes about 30 seconds. We never see your passwords.'
    )
    .setColor(0x8b6cf0);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Verify with Discord').setStyle(ButtonStyle.Link).setURL(`${BASE_URL}/auth/discord`),
    new ButtonBuilder().setLabel('Verify with Roblox').setStyle(ButtonStyle.Link).setURL(`${BASE_URL}/me?connect=roblox`),
  );

  await i.channel.send({ embeds: [embed], components: [row] });
  await i.reply({ content: 'Verification panel posted.', ephemeral: true });
});

client.login(DISCORD_BOT_TOKEN);
