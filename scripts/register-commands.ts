// Run with: npm run register
// Set DISCORD_GUILD_ID in .env.local for instant guild-scoped registration (dev).
// Omit it for global registration (up to 1 hour propagation, use in production).

import { config } from "dotenv";
config({ path: ".env.local" });
config(); // fallback to .env

const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!APPLICATION_ID || !BOT_TOKEN) {
  console.error(
    "Missing DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN in environment."
  );
  process.exit(1);
}

const commands = [
  {
    name: "books",
    description: "Show the current reading list with ratings and Goodreads links",
  },
  {
    name: "add-book",
    description: "Search for a book and add it to the reading list",
    options: [
      {
        name: "query",
        description: "Start typing — pick a result from the suggestions",
        type: 3, // STRING
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: "remove-book",
    description: "Remove a book from the reading list",
    options: [
      {
        name: "book",
        description: "List number (e.g. 3) or pick from the suggestions",
        type: 3, // STRING
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: "vote",
    description: "Vote for the next book to read (one vote per person)",
    options: [
      {
        name: "book",
        description: "Start typing to pick from the reading list",
        type: 3, // STRING
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: "poll",
    description: "Show the current vote tally",
  },
  {
    name: "poll-clear",
    description: "Clear all votes and start a new poll",
  },
  {
    name: "rate",
    description: "Rate a book from 1 to 100 (defaults to currently-reading book)",
    options: [
      {
        name: "score",
        description: "Score from 1 to 100",
        type: 4, // INTEGER
        required: true,
        min_value: 1,
        max_value: 100,
      },
      {
        name: "book",
        description: "Pick a book — leave blank to rate the currently-reading book",
        type: 3, // STRING
        required: false,
        autocomplete: true,
      },
    ],
  },
  {
    name: "poll-end",
    description: "End the poll and set the top-voted book as currently reading",
  },
  {
    name: "clear-current",
    description: "Clear the currently-reading book",
  },
  {
    name: "finish",
    description: "Mark a book as finished (defaults to currently-reading book)",
    options: [
      {
        name: "book",
        description: "Pick a book — leave blank to finish the currently-reading book",
        type: 3, // STRING
        required: false,
        autocomplete: true,
      },
    ],
  },
  {
    name: "archive",
    description: "Show the list of finished books",
  },
];

async function main() {
  const url = GUILD_ID
    ? `https://discord.com/api/v10/applications/${APPLICATION_ID}/guilds/${GUILD_ID}/commands`
    : `https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`;

  console.log(
    GUILD_ID
      ? `Registering commands to guild ${GUILD_ID} (instant)...`
      : "Registering commands globally (up to 1hr to propagate)..."
  );

  const res = await fetch(url, {
    method: "PUT", // idempotent bulk replace
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Failed (${res.status}):`, body);
    process.exit(1);
  }

  const registered = await res.json() as Array<{ name: string }>;
  console.log("Registered:", registered.map((c) => `/${c.name}`).join(", "));
}

main();
