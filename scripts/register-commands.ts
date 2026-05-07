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
        description: "Title, author, or ISBN to search for",
        type: 3, // STRING
        required: true,
      },
    ],
  },
  {
    name: "remove-book",
    description: "Remove a book from the reading list by its ID",
    options: [
      {
        name: "id",
        description: "Book ID shown in the /books list",
        type: 3, // STRING
        required: true,
      },
    ],
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
