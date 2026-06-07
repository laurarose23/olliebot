import {
  Client,
  GatewayIntentBits,
  Events,
  AttachmentBuilder,
  type Message,
  type TextChannel,
} from "discord.js";
import { logger } from "./lib/logger";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cron from "node-cron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHOTOS_DIR = path.resolve(__dirname, "../dog-photos");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

async function getRandomPhoto(): Promise<string | null> {
  try {
    const files = await readdir(PHOTOS_DIR);
    const images = files.filter((f) =>
      IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase())
    );
    if (images.length === 0) return null;
    const pick = images[Math.floor(Math.random() * images.length)];
    return path.join(PHOTOS_DIR, pick);
  } catch {
    return null;
  }
}

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

async function postDailyUpdate(client: Client): Promise<void> {
  const channelId = process.env["DOG_CHANNEL_ID"];
  if (!channelId) {
    logger.warn("DOG_CHANNEL_ID not set — skipping daily update");
    return;
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      logger.warn({ channelId }, "Channel not found or not a text channel");
      return;
    }
    const textChannel = channel as TextChannel;

    const photoPath = await getRandomPhoto();
    const opener = randomFrom(DAILY_OPENERS);
    const update = randomFrom(SILLY_THINGS);

    if (photoPath) {
      const attachment = new AttachmentBuilder(photoPath);
      await textChannel.send({
        content: `${opener}\n${update}\n\n${randomFrom(PHOTO_CAPTIONS)}`,
        files: [attachment],
      });
    } else {
      await textChannel.send(`${opener}\n${update}`);
    }

    logger.info({ channelId }, "Daily dog update posted");
  } catch (err) {
    logger.error({ err }, "Failed to post daily dog update");
  }
}

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
    ],
  });

  client.once(Events.ClientReady, (c) => {
    logger.info({ tag: c.user.tag }, "Dog bot is online and ready to be silly");
    c.user.setActivity("with a sock 🧦");

    // Daily update — default 9am, override with DOG_POST_TIME (cron format)
    const cronTime = process.env["DOG_POST_TIME"] ?? "0 9 * * *";
    cron.schedule(cronTime, () => {
      postDailyUpdate(client).catch((err) =>
        logger.error({ err }, "Unhandled error in daily post")
      );
    });
    logger.info({ cronTime }, "Daily dog update scheduled");
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;

    const content = message.content.toLowerCase().trim();

    if (
      content === "!dog" ||
      content === "!bark" ||
      content === "!silly" ||
      content === "!woof"
    ) {
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
        await message.reply(
          "no photos yet 🥺 add some to the `dog-photos/` folder in the project!"
        );
        return;
      }
      const attachment = new AttachmentBuilder(photoPath);
      await message.reply({
        content: randomFrom(PHOTO_CAPTIONS),
        files: [attachment],
      });
      return;
    }

    if (content === "!dailypost" || content === "!update") {
      await message.reply("posting now! 🐾");
      await postDailyUpdate(client);
      return;
    }

    if (content === "!help" || content === "!commands") {
      const cronTime = process.env["DOG_POST_TIME"] ?? "0 9 * * *";
      await message.reply(
        "**Dog commands 🐾**\n" +
          "`!dog` / `!bark` / `!silly` / `!woof` — get a random silly dog update\n" +
          "`!photo` / `!pic` / `!cute` — post a random photo of the good boy/girl\n" +
          "`!dailypost` / `!update` — trigger today's update right now\n" +
          "`!hello` / `!hi` — say hi and get a very enthusiastic greeting\n" +
          "`!help` — show this message\n\n" +
          `📅 Daily updates scheduled at: \`${cronTime}\` (UTC)\n` +
          "_(set \`DOG_POST_TIME\` env var to change, e.g. \`0 12 * * *\` for noon)_"
      );
      return;
    }

    const mentionedBot =
      message.mentions.has(client.user!) ||
      content.includes("good boy") ||
      content.includes("good girl") ||
      content.includes("who's a good");

    if (mentionedBot) {
      const responses = [
        "*tail wagging intensifies*",
        "ME. I AM. I AM THE GOOD ONE. THANK YOU.",
        "*does a little spin*",
        "i know 🐾",
        "*brings you a shoe as a thank you*",
      ];
      await message.reply(randomFrom(responses));
    }
  });

  client.login(token).catch((err) => {
    logger.error({ err }, "Failed to log in to Discord");
  });
}
