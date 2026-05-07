import type { VercelRequest, VercelResponse } from "@vercel/node";
import { InteractionType, verifyKey } from "discord-interactions";
import { addBook, Book, getBooks, removeBook } from "../lib/books";
import { embedResponse, ephemeralResponse, EMBED_COLOR } from "../lib/discord";
import { getBookById, searchBooks } from "../lib/googleBooks";
import { castVote, clearVotes, getVotes, tallyVotes } from "../lib/votes";

// Required: get raw bytes for Ed25519 signature verification
export const config = { api: { bodyParser: false } };

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const signature = req.headers["x-signature-ed25519"] as string;
  const timestamp = req.headers["x-signature-timestamp"] as string;
  const rawBody = await getRawBody(req);

  const isValid = await verifyKey(
    rawBody,
    signature,
    timestamp,
    process.env.DISCORD_PUBLIC_KEY!
  );

  if (!isValid) {
    return res.status(401).send("Invalid request signature");
  }

  const interaction = JSON.parse(rawBody.toString());

  // Discord sends a PING to verify the endpoint URL
  if (interaction.type === InteractionType.PING) {
    return res.json({ type: 1 });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
    return handleAutocomplete(res, interaction);
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const name: string = interaction.data.name;
    const userId: string =
      interaction.member?.user?.id ?? interaction.user?.id ?? "unknown";

    if (name === "books") {
      return handleBooks(res);
    }
    if (name === "add-book") {
      const query = getOption(interaction, "query") as string;
      return handleAddBook(res, query);
    }
    if (name === "remove-book") {
      const input = getOption(interaction, "book") as string;
      return handleRemoveBook(res, input);
    }
    if (name === "vote") {
      const bookId = getOption(interaction, "book") as string;
      return handleVote(res, userId, bookId);
    }
    if (name === "poll") {
      return handlePoll(res);
    }
    if (name === "poll-clear") {
      return handlePollClear(res);
    }
  }

  return res.status(400).send("Unknown interaction type");
}

async function handleAutocomplete(res: VercelResponse, interaction: any) {
  const commandName: string = interaction.data.name;
  const focused = interaction.data.options?.find((o: any) => o.focused);
  const query = ((focused?.value as string) ?? "").trim();

  // /add-book: search Google Books live and offer top results
  if (commandName === "add-book") {
    if (query.length < 2) {
      return res.json({ type: 8, data: { choices: [] } });
    }
    let results;
    try {
      results = await searchBooks(query);
    } catch (err) {
      console.error("Autocomplete Google Books error:", err);
      return res.json({ type: 8, data: { choices: [] } });
    }
    const choices = results.slice(0, 25).map((b) => ({
      name: truncate(`${b.title} — ${b.author}`, 100),
      value: b.id,
    }));
    return res.json({ type: 8, data: { choices } });
  }

  // /vote and /remove-book: filter the current reading list
  if (commandName === "vote" || commandName === "remove-book") {
    const lower = query.toLowerCase();
    const books = await getBooks();
    const matches = books.filter((b, i) =>
      lower === ""
        ? true
        : `${i + 1} ${b.title} ${b.author}`.toLowerCase().includes(lower)
    );
    const choices = matches.slice(0, 25).map((b, i) => {
      const realIndex = books.indexOf(b);
      return {
        name: truncate(`${realIndex + 1}. ${b.title} — ${b.author}`, 100),
        value: b.id,
      };
    });
    return res.json({ type: 8, data: { choices } });
  }

  return res.json({ type: 8, data: { choices: [] } });
}

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max - 1) + "…";
}

function getOption(interaction: any, name: string): unknown {
  return interaction.data.options?.find((o: any) => o.name === name)?.value;
}

async function handleBooks(res: VercelResponse) {
  const books = await getBooks();

  if (books.length === 0) {
    return res.json(
      ephemeralResponse(
        "No books in the reading list yet. Use `/add-book` to add one!"
      )
    );
  }

  const fields = books.map((book, i) => {
    const ratingLine = book.rating
      ? `${book.rating}/5 ⭐ (${book.ratingsCount?.toLocaleString()} ratings)`
      : "No rating available";

    return {
      name: `${i + 1}. ${book.title}`,
      value: [
        `by **${book.author}**`,
        ratingLine,
        `[Search on Goodreads](${book.goodreadsUrl})`,
        `ID: \`${book.id}\``,
      ].join("\n"),
      inline: false,
    };
  });

  const embed = {
    title: "📚 Reading List",
    color: EMBED_COLOR,
    fields: fields.slice(0, 25), // Discord limit
    footer: {
      text: `${books.length} book${books.length === 1 ? "" : "s"} total`,
    },
  };

  return res.json(embedResponse(embed));
}

async function handleAddBook(res: VercelResponse, query: string) {
  // If autocomplete was used, query is a Google Books volume ID — fetch directly.
  // Otherwise, fall back to a search and use the top result.
  let best;
  try {
    const byId = await getBookById(query).catch(() => null);
    if (byId) {
      best = byId;
    } else {
      const results = await searchBooks(query);
      if (results.length === 0) {
        return res.json(
          ephemeralResponse(
            `No books found for "${query}". Try a different title or author.`
          )
        );
      }
      best = results[0];
    }
  } catch (err) {
    console.error("Google Books fetch error:", err);
    return res.json(
      ephemeralResponse("Failed to reach Google Books. Please try again.")
    );
  }

  const result = await addBook({ ...best, addedAt: new Date().toISOString() });

  if (result === "duplicate") {
    return res.json(
      ephemeralResponse(
        `**${best.title}** is already in the reading list.`
      )
    );
  }

  const ratingLine = best.rating
    ? `${best.rating}/5 ⭐ (${best.ratingsCount?.toLocaleString()} ratings)`
    : "No rating available";

  const embed = {
    title: "✅ Book Added",
    color: EMBED_COLOR,
    thumbnail: best.thumbnail ? { url: best.thumbnail } : undefined,
    fields: [
      { name: "Title", value: best.title, inline: true },
      { name: "Author", value: best.author, inline: true },
      { name: "Rating", value: ratingLine, inline: true },
      {
        name: "Goodreads",
        value: `[Search on Goodreads](${best.goodreadsUrl})`,
        inline: false,
      },
      {
        name: "Book ID",
        value: `\`${best.id}\` *(use with \`/remove-book\`)*`,
        inline: false,
      },
    ],
  };

  return res.json(embedResponse(embed));
}

async function handleRemoveBook(res: VercelResponse, input: string) {
  const trimmed = input.trim();
  const books = await getBooks();

  // If the input is a positive integer in range, treat it as the list number
  const asNumber = Number(trimmed);
  let targetId: string | null = null;
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= books.length) {
    targetId = books[asNumber - 1].id;
  } else {
    targetId = trimmed;
  }

  const removed = await removeBook(targetId);

  if (!removed) {
    return res.json(
      ephemeralResponse(
        `No book found matching \`${input}\`. Use \`/books\` to see the list.`
      )
    );
  }

  return res.json(ephemeralResponse("Book removed from the reading list."));
}

async function handleVote(res: VercelResponse, userId: string, bookId: string) {
  const books = await getBooks();
  const book = books.find((b) => b.id === bookId);

  if (!book) {
    return res.json(
      ephemeralResponse(
        "That book is no longer in the reading list. Use `/books` to see current options."
      )
    );
  }

  await castVote(userId, bookId);
  return res.json(
    ephemeralResponse(
      `🗳️ Your vote is in for **${book.title}** by ${book.author}. Use \`/poll\` to see the tally.`
    )
  );
}

async function handlePoll(res: VercelResponse) {
  const [books, votes] = await Promise.all([getBooks(), getVotes()]);
  const tally = tallyVotes(votes);
  const total = Object.keys(votes).length;

  if (total === 0) {
    return res.json(
      ephemeralResponse("No votes yet. Use `/vote` to cast yours!")
    );
  }

  const bookById = new Map<string, Book>(books.map((b) => [b.id, b]));

  const lines = tally.map((entry, i) => {
    const book = bookById.get(entry.bookId);
    const label = book
      ? `**${book.title}** — ${book.author}`
      : `*(removed book ${entry.bookId})*`;
    const medal = i === 0 ? "🏆" : i === 1 ? "🥈" : i === 2 ? "🥉" : "•";
    const pct = Math.round((entry.count / total) * 100);
    return `${medal} ${label}\n   ${entry.count} vote${
      entry.count === 1 ? "" : "s"
    } (${pct}%)`;
  });

  const embed = {
    title: "🗳️ Current Poll",
    description: lines.join("\n\n"),
    color: EMBED_COLOR,
    footer: {
      text: `${total} total vote${total === 1 ? "" : "s"}`,
    },
  };

  return res.json(embedResponse(embed));
}

async function handlePollClear(res: VercelResponse) {
  const cleared = await clearVotes();
  return res.json(
    ephemeralResponse(
      `🧹 Cleared ${cleared} vote${cleared === 1 ? "" : "s"}. Polls reset.`
    )
  );
}
