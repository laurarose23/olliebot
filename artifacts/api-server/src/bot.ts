import {
  Client,
  GatewayIntentBits,
  Events,
  AttachmentBuilder,
  type Message,
  type TextChannel,
} from "discord.js";
import { logger } from "./lib/logger";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cron from "node-cron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHOTOS_DIR = path.resolve(__dirname, "../dog-photos");
const VOTE_STATE_FILE = path.resolve(__dirname, "../vote-state.json");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

const NUMBER_EMOJIS = [
  "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣",
  "6️⃣", "7️⃣", "8️⃣", "9️⃣",
];

// ── Vote state ──────────────────────────────────────────────────────────────

interface VoteEntry {
  messageId: string;
  photoName: string;
  emoji: string;
}

interface VoteState {
  active: boolean;
  channelId: string;
  startedAt: string;
  entries: VoteEntry[];
}

async function loadVoteState(): Promise<VoteState | null> {
  try {
    const raw = await readFile(VOTE_STATE_FILE, "utf-8");
    return JSON.parse(raw) as VoteState;
  } catch {
    return null;
  }
}

async function saveVoteState(state: VoteState): Promise<void> {
  await writeFile(VOTE_STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

async function clearVoteState(): Promise<void> {
  const empty: VoteState = {
    active: false,
    channelId: "",
    startedAt: "",
    entries: [],
  };
  await saveVoteState(empty);
}

// ── Photos ───────────────────────────────────────────────────────────────────

async function getAllPhotos(): Promise<string[]> {
  try {
    const files = await readdir(PHOTOS_DIR);
    return files.filter((f) =>
      IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase())
    );
  } catch {
    return [];
  }
}

async function getRandomPhoto(): Promise<string | null> {
  const photos = await getAllPhotos();
  if (photos.length === 0) return null;
  return path.join(PHOTOS_DIR, photos[Math.floor(Math.random() * photos.length)]);
}

// ── Copy pools ───────────────────────────────────────────────────────────────

const SILLY_THINGS = [
  "*zooms around the living room for no reason at all* 🏃",
  "found a sock. this is my sock now. don't ask questions.",
  "there is DEFINITELY something outside. i don't know what it is but it needs to be barked at immediately.",
  "someone rang the doorbell on TV and now i have lost my mind completely",
  "i have been staring at this spot on the wall for 20 minutes. the spot knows what it did.",
  "refused to walk on the weird part of the sidewalk. you know the one.",
  "someone said 'walk' in a completely unrelated sentence and i am now ready. leash. NOW.",
  "rolled in something outside. i smell incredible. everyone else is wrong.",
  "the mailman came. i have never been more furious in my entire life.",
  "sat on the remote and changed the channel and then looked very pleased with myself",
  "found a chip under the couch from 2 weeks ago. ate it. no notes.",
  "licked the air for a moment and then just walked away",
  "heard someone open the fridge from the other side of the house. appeared instantly.",
  "tried to fit my whole body under the coffee table. most of me made it.",
  "had a dream. was very upset about it.",
  "barked at my own reflection and then got embarrassed",
  "saw a plastic bag. absolutely unacceptable. barked until it stopped existing.",
  "brought you a shoe as a gift. it's not even your shoe. you're welcome.",
  "sneezed so hard i scared myself",
  "spun in a circle seven times before lying down. the eighth spin was unnecessary.",
  "ate my food in 4 seconds, then looked at you like you were hiding more food",
  "sat on your laptop to tell you it's time to pay attention to me",
  "heard the word 'bath' from three rooms away. am now hiding.",
  "stole a piece of toast and looked you dead in the eyes while eating it",
  "the vacuum is on. I REPEAT, THE VACUUM IS ON. THIS IS NOT A DRILL.",
];

const GREETINGS = [
  "HELLO HELLO HELLO *vibrates*",
  "YOU'RE HERE. I CANNOT BELIEVE YOU'RE HERE. I MISSED YOU SO MUCH (it's been 4 minutes)",
  "oh hi oh hi oh hi oh hi",
  "*aggressively wags*",
  "YOU!! I CHOOSE YOU!!",
];

const PHOTO_CAPTIONS = [
  "look at this angel 😇",
  "just a regular supermodel, no big deal 🐾",
  "caught being perfect (as usual)",
  "this is my good side. they're all my good side.",
  "available for head scratches and treats 🦴",
  "professional couch occupier 🛋️",
  "living my best life rn",
  "a whole entire good boy/girl in one photo",
];

const DAILY_OPENERS = [
  "🐾 **daily dog update:**",
  "📰 **breaking news from the dog:**",
  "🌅 **good morning. here is your dog report:**",
  "📋 **today's dog activities:**",
  "🐕 **hi it's me, your dog. here's what's happening:**",
];

function randomFrom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Daily update ─────────────────────────────────────────────────────────────

async function postDailyUpdate(client: Client): Promise<void> {
  const channelId = process.env["DOG_CHANNEL_ID"];
  if (!channelId) {
    logger.warn("DOG_CHANNEL_ID not set — skipping daily update");
    return;
  }
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      logger.warn({ channelId }, "Channel not found or not a text channel");
      return;
    }
    const textChannel = channel as TextChannel;
    const photoPath = await getRandomPhoto();
    const opener = randomFrom(DAILY_OPENERS);
    const update = randomFrom(SILLY_THINGS);

    if (photoPath) {
      await textChannel.send({
        content: `${opener}\n${update}\n\n${randomFrom(PHOTO_CAPTIONS)}`,
        files: [new AttachmentBuilder(photoPath)],
      });
    } else {
      await textChannel.send(`${opener}\n${update}`);
    }
    logger.info({ channelId }, "Daily dog update posted");
  } catch (err) {
    logger.error({ err }, "Failed to post daily dog update");
  }
}

// ── Vote helpers ──────────────────────────────────────────────────────────────

async function startVote(client: Client, channelId: string): Promise<string> {
  const existing = await loadVoteState();
  if (existing?.active) {
    return "a vote is already running! use `!endvote` to finish it first.";
  }

  const photos = await getAllPhotos();
  if (photos.length === 0) {
    return "no photos found in the `dog-photos/` folder yet — add some first!";
  }

  const limited = photos.slice(0, NUMBER_EMOJIS.length);
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) return "couldn't find that channel.";
  const textChannel = channel as TextChannel;

  await textChannel.send(
    "🗳️ **weekly best dog photo vote!**\nreact with the number below each photo to cast your vote. voting ends when someone runs `!endvote`!"
  );

  const entries: VoteEntry[] = [];
  for (let i = 0; i < limited.length; i++) {
    const photoName = limited[i];
    const emoji = NUMBER_EMOJIS[i];
    const filePath = path.join(PHOTOS_DIR, photoName);
    const msg = await textChannel.send({
      content: `${emoji} **photo ${i + 1}**`,
      files: [new AttachmentBuilder(filePath)],
    });
    await msg.react(emoji);
    entries.push({ messageId: msg.id, photoName, emoji });
  }

  await saveVoteState({
    active: true,
    channelId,
    startedAt: new Date().toISOString(),
    entries,
  });

  logger.info({ photos: limited.length }, "Vote started");
  return `vote started with ${limited.length} photo${limited.length !== 1 ? "s" : ""}! react to vote 🐾`;
}

async function endVote(client: Client): Promise<string> {
  const state = await loadVoteState();
  if (!state?.active || state.entries.length === 0) {
    return "no vote is currently running. start one with `!startvote`!";
  }

  const channel = await client.channels.fetch(state.channelId);
  if (!channel?.isTextBased()) return "couldn't find the vote channel.";
  const textChannel = channel as TextChannel;

  let winner: VoteEntry | null = null;
  let highScore = -1;
  const results: string[] = [];

  for (const entry of state.entries) {
    try {
      const msg = await textChannel.messages.fetch(entry.messageId);
      const reaction = msg.reactions.cache.get(entry.emoji);
      // subtract 1 for the bot's own reaction
      const count = (reaction?.count ?? 1) - 1;
      results.push(`${entry.emoji} **photo** — ${count} vote${count !== 1 ? "s" : ""}`);
      if (count > highScore) {
        highScore = count;
        winner = entry;
      }
    } catch {
      results.push(`${entry.emoji} *(couldn't fetch)*`);
    }
  }

  let announcement: string;
  if (!winner || highScore === 0) {
    announcement =
      "🗳️ **vote results!**\n" +
      results.join("\n") +
      "\n\nno votes yet... everyone's a winner in my heart 🐾";
  } else {
    announcement =
      "🗳️ **vote results!**\n" +
      results.join("\n") +
      `\n\n👑 **this week's best dog photo:** ${winner.emoji} **${winner.photoName}** with ${highScore} vote${highScore !== 1 ? "s" : ""}! absolutely iconic.`;

    try {
      const winMsg = await textChannel.messages.fetch(winner.messageId);
      await winMsg.reply(`👑 **THIS ONE! ${highScore} vote${highScore !== 1 ? "s" : ""}! WINNER WINNER CHICKEN DINNER** 🏆`);
    } catch { /* best effort */ }
  }

  await textChannel.send(announcement);
  await clearVoteState();
  logger.info({ winner: winner?.photoName, highScore }, "Vote ended");
  return "vote closed!";
}

// ── Bot startup ───────────────────────────────────────────────────────────────

export function startBot(): void {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    logger.warn("DISCORD_BOT_TOKEN not set — skipping bot startup");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMessageReactions,
    ],
  });

  client.once(Events.ClientReady, (c) => {
    logger.info({ tag: c.user.tag }, "Dog bot is online and ready to be silly");
    c.user.setActivity("with a sock 🧦");

    const cronTime = process.env["DOG_POST_TIME"] ?? "0 9 * * *";
    cron.schedule(cronTime, () => {
      postDailyUpdate(client).catch((err) =>
        logger.error({ err }, "Unhandled error in daily post")
      );
    });
    logger.info({ cronTime }, "Daily dog update scheduled");

    // Auto end vote every Sunday at 8pm UTC
    cron.schedule("0 20 * * 0", () => {
      endVote(client).catch((err) =>
        logger.error({ err }, "Unhandled error in auto vote end")
      );
    });
    logger.info("Weekly vote auto-close scheduled (Sunday 20:00 UTC)");
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;

    const content = message.content.toLowerCase().trim();
    const channelId =
      message.channelId ?? process.env["DOG_CHANNEL_ID"] ?? "";

    if (content === "!dog" || content === "!bark" || content === "!silly" || content === "!woof") {
      await message.reply(randomFrom(SILLY_THINGS));
      return;
    }

    if (content === "!hello" || content === "!hi" || content === "!hey") {
      await message.reply(randomFrom(GREETINGS));
      return;
    }

    if (content === "!photo" || content === "!pic" || content === "!cute") {
      const photoPath = await getRandomPhoto();
      if (!photoPath) {
        await message.reply("no photos yet 🥺 add some to the `dog-photos/` folder!");
        return;
      }
      await message.reply({ content: randomFrom(PHOTO_CAPTIONS), files: [new AttachmentBuilder(photoPath)] });
      return;
    }

    if (content === "!dailypost" || content === "!update") {
      await message.reply("posting now! 🐾");
      await postDailyUpdate(client);
      return;
    }

    if (content === "!startvote") {
      const reply = await startVote(client, channelId);
      await message.reply(reply);
      return;
    }

    if (content === "!endvote") {
      await message.reply("tallying votes... 🗳️");
      await endVote(client);
      return;
    }

    if (content === "!help" || content === "!commands") {
      const cronTime = process.env["DOG_POST_TIME"] ?? "0 9 * * *";
      await message.reply(
        "**Dog commands 🐾**\n" +
          "`!dog` / `!bark` / `!silly` / `!woof` — get a random silly dog update\n" +
          "`!photo` / `!pic` / `!cute` — post a random photo\n" +
          "`!dailypost` / `!update` — trigger today's update right now\n" +
          "`!startvote` — start a weekly best-photo vote in this channel\n" +
          "`!endvote` — tally votes and announce the winner 👑\n" +
          "`!hello` / `!hi` — very enthusiastic greeting\n" +
          "`!help` — show this message\n\n" +
          `📅 Daily updates: \`${cronTime}\` (UTC) · Vote auto-closes Sundays 20:00 UTC`
      );
      return;
    }

    const mentionedBot =
      message.mentions.has(client.user!) ||
      content.includes("good boy") ||
      content.includes("good girl") ||
      content.includes("who's a good");

    if (mentionedBot) {
      await message.reply(randomFrom([
        "*tail wagging intensifies*",
        "ME. I AM. I AM THE GOOD ONE. THANK YOU.",
        "*does a little spin*",
        "i know 🐾",
        "*brings you a shoe as a thank you*",
      ]));
    }
  });

  client.login(token).catch((err) => {
    logger.error({ err }, "Failed to log in to Discord");
  });
}
