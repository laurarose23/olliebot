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
const PHOTOS_DIR        = path.resolve(__dirname, "../dog-photos");
const VOTE_STATE_FILE   = path.resolve(__dirname, "../vote-state.json");
const CONFIG_FILE       = path.resolve(__dirname, "../dog-config.json");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

const NUMBER_EMOJIS = [
  "1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣",
];

// ── Config (birthday, name) ───────────────────────────────────────────────────

interface DogConfig {
  birthday?: string;     // "MM-DD"
  birthdayYear?: number; // birth year for age calculation
  name?: string;
}

async function loadConfig(): Promise<DogConfig> {
  try {
    return JSON.parse(await readFile(CONFIG_FILE, "utf-8")) as DogConfig;
  } catch {
    return {};
  }
}

async function saveConfig(cfg: DogConfig): Promise<void> {
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
}

// ── Vote state ────────────────────────────────────────────────────────────────

interface VoteEntry { messageId: string; photoName: string; emoji: string; }
interface VoteState  { active: boolean; channelId: string; startedAt: string; entries: VoteEntry[]; }

async function loadVoteState(): Promise<VoteState | null> {
  try {
    return JSON.parse(await readFile(VOTE_STATE_FILE, "utf-8")) as VoteState;
  } catch { return null; }
}
async function saveVoteState(s: VoteState) {
  await writeFile(VOTE_STATE_FILE, JSON.stringify(s, null, 2), "utf-8");
}
async function clearVoteState() {
  await saveVoteState({ active: false, channelId: "", startedAt: "", entries: [] });
}

// ── Photos ────────────────────────────────────────────────────────────────────

async function getAllPhotos(): Promise<string[]> {
  try {
    const files = await readdir(PHOTOS_DIR);
    return files.filter(f => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()));
  } catch { return []; }
}

async function getRandomPhoto(): Promise<string | null> {
  const photos = await getAllPhotos();
  if (!photos.length) return null;
  return path.join(PHOTOS_DIR, photos[Math.floor(Math.random() * photos.length)]);
}

// ── Copy pools ────────────────────────────────────────────────────────────────

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

const BIRTHDAY_MESSAGES = [
  "I AM {age} YEARS OLD TODAY AND I HAVE NEVER BEEN MORE POWERFUL",
  "another year of being INCREDIBLY GOOD. the streak continues.",
  "today i am {age}. i have earned {age} treats. minimum.",
  "officially {age} years of being the best thing that ever happened to this house",
  "i am {age} today and i expect the entire day to be about me. (it's always about me but today ESPECIALLY)",
];

function randomFrom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Birthday helpers ──────────────────────────────────────────────────────────

function parseBirthday(mmdd: string): { month: number; day: number } | null {
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(mmdd.trim());
  if (!match) return null;
  const month = parseInt(match[1], 10);
  const day   = parseInt(match[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

function daysUntilBirthday(mmdd: string): number {
  const parsed = parseBirthday(mmdd);
  if (!parsed) return -1;
  const now  = new Date();
  const thisYear = new Date(now.getFullYear(), parsed.month - 1, parsed.day);
  const nextYear = new Date(now.getFullYear() + 1, parsed.month - 1, parsed.day);
  const target   = thisYear >= now ? thisYear : nextYear;
  return Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
}

function isTodayBirthday(mmdd: string): boolean {
  const parsed = parseBirthday(mmdd);
  if (!parsed) return false;
  const now = new Date();
  return now.getMonth() + 1 === parsed.month && now.getDate() === parsed.day;
}

// ── Daily update ──────────────────────────────────────────────────────────────

async function postDailyUpdate(client: Client): Promise<void> {
  const channelId = process.env["DOG_CHANNEL_ID"];
  if (!channelId) { logger.warn("DOG_CHANNEL_ID not set"); return; }
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;
    const ch = channel as TextChannel;
    const photoPath = await getRandomPhoto();
    const opener  = randomFrom(DAILY_OPENERS);
    const update  = randomFrom(SILLY_THINGS);
    if (photoPath) {
      await ch.send({ content: `${opener}\n${update}\n\n${randomFrom(PHOTO_CAPTIONS)}`, files: [new AttachmentBuilder(photoPath)] });
    } else {
      await ch.send(`${opener}\n${update}`);
    }
    logger.info({ channelId }, "Daily dog update posted");
  } catch (err) { logger.error({ err }, "Failed to post daily update"); }
}

// ── Birthday celebration ──────────────────────────────────────────────────────

async function postBirthdayCelebration(client: Client): Promise<void> {
  const channelId = process.env["DOG_CHANNEL_ID"];
  if (!channelId) return;

  const cfg = await loadConfig();
  if (!cfg.birthday || !isTodayBirthday(cfg.birthday)) return;

  const parsed = parseBirthday(cfg.birthday)!;
  const now    = new Date();
  const age    = now.getFullYear() - (cfg.birthdayYear as number | undefined ?? now.getFullYear());
  const name   = cfg.name ?? "the dog";

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;
    const ch = channel as TextChannel;

    const rawMsg = randomFrom(BIRTHDAY_MESSAGES).replace(/\{age\}/g, String(age));
    const msg =
      `🎂🎉🎈🎁🥳🎊🐾🎂🎉🎈🎁🥳🎊\n` +
      `**IT IS ${name.toUpperCase()}'S BIRTHDAY!!!**\n` +
      `🎂🎉🎈🎁🥳🎊🐾🎂🎉🎈🎁🥳🎊\n\n` +
      `${rawMsg}\n\n` +
      `everyone please shower ${name} with love immediately. thank you.`;

    const photoPath = await getRandomPhoto();
    if (photoPath) {
      await ch.send({ content: msg, files: [new AttachmentBuilder(photoPath)] });
    } else {
      await ch.send(msg);
    }
    logger.info({ name }, "Birthday celebration posted");
  } catch (err) { logger.error({ err }, "Failed to post birthday celebration"); }
}

// ── Vote helpers ──────────────────────────────────────────────────────────────

async function startVote(client: Client, channelId: string): Promise<string> {
  const existing = await loadVoteState();
  if (existing?.active) return "a vote is already running! use `!endvote` to finish it first.";

  const photos = await getAllPhotos();
  if (!photos.length) return "no photos found in `dog-photos/` yet — add some first!";

  const limited = photos.slice(0, NUMBER_EMOJIS.length);
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) return "couldn't find that channel.";
  const ch = channel as TextChannel;

  await ch.send("🗳️ **weekly best dog photo vote!**\nreact with the number below each photo to cast your vote. voting ends when someone runs `!endvote`!");

  const entries: VoteEntry[] = [];
  for (let i = 0; i < limited.length; i++) {
    const photoName = limited[i];
    const emoji = NUMBER_EMOJIS[i];
    const msg = await ch.send({ content: `${emoji} **photo ${i + 1}**`, files: [new AttachmentBuilder(path.join(PHOTOS_DIR, photoName))] });
    await msg.react(emoji);
    entries.push({ messageId: msg.id, photoName, emoji });
  }

  await saveVoteState({ active: true, channelId, startedAt: new Date().toISOString(), entries });
  logger.info({ count: limited.length }, "Vote started");
  return `vote started with ${limited.length} photo${limited.length !== 1 ? "s" : ""}! react to vote 🐾`;
}

async function endVote(client: Client): Promise<string> {
  const state = await loadVoteState();
  if (!state?.active || !state.entries.length) return "no vote is currently running. start one with `!startvote`!";

  const channel = await client.channels.fetch(state.channelId);
  if (!channel?.isTextBased()) return "couldn't find the vote channel.";
  const ch = channel as TextChannel;

  let winner: VoteEntry | null = null;
  let highScore = -1;
  const results: string[] = [];

  for (const entry of state.entries) {
    try {
      const msg      = await ch.messages.fetch(entry.messageId);
      const reaction = msg.reactions.cache.get(entry.emoji);
      const count    = (reaction?.count ?? 1) - 1;
      results.push(`${entry.emoji} **photo** — ${count} vote${count !== 1 ? "s" : ""}`);
      if (count > highScore) { highScore = count; winner = entry; }
    } catch {
      results.push(`${entry.emoji} *(couldn't fetch)*`);
    }
  }

  let announcement: string;
  if (!winner || highScore === 0) {
    announcement = "🗳️ **vote results!**\n" + results.join("\n") + "\n\nno votes yet... everyone's a winner in my heart 🐾";
  } else {
    announcement = "🗳️ **vote results!**\n" + results.join("\n") +
      `\n\n👑 **this week's best dog photo:** ${winner.emoji} with ${highScore} vote${highScore !== 1 ? "s" : ""}! absolutely iconic.`;
    try {
      const winMsg = await ch.messages.fetch(winner.messageId);
      await winMsg.reply(`👑 **THIS ONE! ${highScore} vote${highScore !== 1 ? "s" : ""}! WINNER WINNER CHICKEN DINNER** 🏆`);
    } catch { /* best effort */ }
  }

  await ch.send(announcement);
  await clearVoteState();
  logger.info({ winner: winner?.photoName, highScore }, "Vote ended");
  return "vote closed!";
}

// ── Bot startup ───────────────────────────────────────────────────────────────

export function startBot(): void {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) { logger.warn("DISCORD_BOT_TOKEN not set — skipping bot startup"); return; }

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

    // Daily update + birthday check at post time
    cron.schedule(cronTime, () => {
      postBirthdayCelebration(client).catch(err => logger.error({ err }, "Birthday check failed"));
      postDailyUpdate(client).catch(err => logger.error({ err }, "Daily post failed"));
    });
    logger.info({ cronTime }, "Daily dog update scheduled");

    // Auto end vote every Sunday at 8pm UTC
    cron.schedule("0 20 * * 0", () => {
      endVote(client).catch(err => logger.error({ err }, "Auto vote end failed"));
    });
    logger.info("Weekly vote auto-close scheduled (Sunday 20:00 UTC)");
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;

    const content   = message.content.toLowerCase().trim();
    const rawArgs   = message.content.trim().split(/\s+/);
    const channelId = message.channelId ?? process.env["DOG_CHANNEL_ID"] ?? "";

    // ── silly ──
    if (["!dog","!bark","!silly","!woof"].includes(content)) {
      await message.reply(randomFrom(SILLY_THINGS));
      return;
    }

    // ── greet ──
    if (["!hello","!hi","!hey"].includes(content)) {
      await message.reply(randomFrom(GREETINGS));
      return;
    }

    // ── photo ──
    if (["!photo","!pic","!cute"].includes(content)) {
      const photoPath = await getRandomPhoto();
      if (!photoPath) { await message.reply("no photos yet 🥺 add some to the `dog-photos/` folder!"); return; }
      await message.reply({ content: randomFrom(PHOTO_CAPTIONS), files: [new AttachmentBuilder(photoPath)] });
      return;
    }

    // ── daily post ──
    if (["!dailypost","!update"].includes(content)) {
      await message.reply("posting now! 🐾");
      await postDailyUpdate(client);
      return;
    }

    // ── vote ──
    if (content === "!startvote") {
      await message.reply(await startVote(client, channelId));
      return;
    }
    if (content === "!endvote") {
      await message.reply("tallying votes... 🗳️");
      await endVote(client);
      return;
    }

    // ── birthday: set ──
    // !setbirthday MM-DD  (optional: !setbirthday MM-DD YEAR  !setname NAME)
    if (rawArgs[0]?.toLowerCase() === "!setbirthday") {
      const mmdd = rawArgs[1];
      if (!mmdd || !parseBirthday(mmdd)) {
        await message.reply("usage: `!setbirthday MM-DD` — e.g. `!setbirthday 03-15`");
        return;
      }
      const year = rawArgs[2] ? parseInt(rawArgs[2], 10) : undefined;
      const cfg  = await loadConfig();
      cfg.birthday = mmdd;
      if (year && !isNaN(year)) cfg.birthdayYear = year;
      await saveConfig(cfg);
      const days = daysUntilBirthday(mmdd);
      const name = cfg.name ?? "the dog";
      await message.reply(
        days === 0
          ? `🎂 birthday saved as **${mmdd}** — and that's TODAY?! 🎉 HAPPY BIRTHDAY ${name.toUpperCase()}!!!`
          : `🎂 birthday saved as **${mmdd}**! that's in **${days} day${days !== 1 ? "s" : ""}**. i am already excited.`
      );
      return;
    }

    // ── birthday: set name ──
    if (rawArgs[0]?.toLowerCase() === "!setname") {
      const name = rawArgs.slice(1).join(" ").trim();
      if (!name) { await message.reply("usage: `!setname <dog's name>` — e.g. `!setname Biscuit`"); return; }
      const cfg = await loadConfig();
      cfg.name = name;
      await saveConfig(cfg);
      await message.reply(`name saved! the dog is now officially **${name}** 🐾`);
      return;
    }

    // ── birthday: countdown ──
    if (content === "!birthday") {
      const cfg = await loadConfig();
      if (!cfg.birthday) {
        await message.reply("no birthday set yet! use `!setbirthday MM-DD` to set one.");
        return;
      }
      const days = daysUntilBirthday(cfg.birthday);
      const name = cfg.name ?? "the dog";
      if (days === 0) {
        await message.reply(`🎂🎉 **IT'S ${name.toUpperCase()}'S BIRTHDAY TODAY!!!** 🎉🎂 everyone celebrate immediately!!`);
      } else if (days === 1) {
        await message.reply(`🎂 **${name}'s birthday is TOMORROW!!!** i am already vibrating with excitement`);
      } else {
        await message.reply(`🗓️ **${days} days** until ${name}'s birthday (${cfg.birthday})! i am already so excited i cannot stand it`);
      }
      return;
    }

    // ── help ──
    if (["!help","!commands"].includes(content)) {
      const cronTime = process.env["DOG_POST_TIME"] ?? "0 9 * * *";
      const cfg = await loadConfig();
      const bday = cfg.birthday
        ? `\`${cfg.birthday}\` — ${daysUntilBirthday(cfg.birthday)} day(s) away`
        : "not set (`!setbirthday MM-DD`)";
      await message.reply(
        "**Dog commands 🐾**\n" +
        "`!dog` / `!bark` / `!silly` / `!woof` — random silly update\n" +
        "`!photo` / `!pic` / `!cute` — random photo\n" +
        "`!dailypost` / `!update` — trigger today's post now\n" +
        "`!startvote` — start weekly best-photo vote\n" +
        "`!endvote` — tally votes & announce winner 👑\n" +
        "`!birthday` — countdown to the big day 🎂\n" +
        "`!setbirthday MM-DD` — set the birthday (add birth year for age: `!setbirthday 03-15 2020`)\n" +
        "`!setname <name>` — set the dog's name\n" +
        "`!hello` / `!hi` — very enthusiastic greeting\n" +
        "`!help` — this message\n\n" +
        `📅 Daily posts: \`${cronTime}\` (UTC) · Vote auto-closes Sundays 20:00 UTC\n` +
        `🎂 Birthday: ${bday}`
      );
      return;
    }

    // ── good dog ──
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

  client.login(token).catch(err => logger.error({ err }, "Failed to log in to Discord"));
}
