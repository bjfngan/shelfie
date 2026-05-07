import type { VercelRequest, VercelResponse } from "@vercel/node";
import { InteractionType, verifyKey } from "discord-interactions";
import { addBook, Book, getBooks, removeBook } from "../lib/books";
import { embedResponse, ephemeralResponse, EMBED_COLOR } from "../lib/discord";
import { getBookById, searchBooks } from "../lib/googleBooks";
import {
  castVote,
  clearVotes,
  getVotes,
  setVotes,
  tallyVotes,
} from "../lib/votes";
import {
  clearRatings,
  getRatings,
  setRating,
  summarize,
} from "../lib/ratings";
import { clearCurrent, getCurrent, setCurrent } from "../lib/current";
import { addToArchive, getArchive } from "../lib/archive";

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
    if (name === "rate") {
      const bookId = getOption(interaction, "book") as string | undefined;
      const score = getOption(interaction, "score") as number;
      return handleRate(res, userId, bookId ?? null, score);
    }
    if (name === "current") {
      const bookId = getOption(interaction, "book") as string | undefined;
      return handleCurrent(res, bookId ?? null);
    }
    if (name === "clear-current") {
      return handleClearCurrent(res);
    }
    if (name === "finish") {
      const bookId = getOption(interaction, "book") as string;
      return handleFinish(res, bookId);
    }
    if (name === "archive") {
      return handleArchive(res);
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

  // /vote, /remove-book, /rate, /current, /finish: filter the current reading list
  if (
    commandName === "vote" ||
    commandName === "remove-book" ||
    commandName === "rate" ||
    commandName === "current" ||
    commandName === "finish"
  ) {
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
  const [books, ratings, currentId] = await Promise.all([
    getBooks(),
    getRatings(),
    getCurrent(),
  ]);

  if (books.length === 0) {
    return res.json(
      ephemeralResponse(
        "No books in the reading list yet. Use `/add-book` to add one!"
      )
    );
  }

  const fields = books.map((book, i) => {
    const lines: string[] = [`by **${book.author}**`];
    if (book.pageCount) lines.push(`📖 ${book.pageCount} pages`);
    if (book.genres && book.genres.length > 0) {
      lines.push(book.genres.map((g) => `\`${g}\``).join(" "));
    }
    const summary = summarize(ratings, book.id);
    if (summary) {
      lines.push(
        `⭐ ${summary.average}/100 (${summary.count} rating${
          summary.count === 1 ? "" : "s"
        })`
      );
    }
    lines.push(`[View on Goodreads](${book.goodreadsUrl})`);

    const marker = book.id === currentId ? "📖 " : "";
    return {
      name: `${marker}${i + 1}. ${book.title}`,
      value: lines.join("\n"),
      inline: false,
    };
  });

  const currentBook = currentId
    ? books.find((b) => b.id === currentId)
    : undefined;
  const description = currentBook
    ? `📖 Currently reading: **${currentBook.title}** by ${currentBook.author}`
    : undefined;

  const embed = {
    title: "📚 Reading List",
    description,
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

  const fields: any[] = [
    { name: "Title", value: best.title, inline: true },
    { name: "Author", value: best.author, inline: true },
  ];
  if (best.pageCount) {
    fields.push({ name: "Pages", value: `${best.pageCount}`, inline: true });
  }
  if (best.genres && best.genres.length > 0) {
    fields.push({
      name: "Genres",
      value: best.genres.map((g) => `\`${g}\``).join(" "),
      inline: false,
    });
  }
  fields.push({
    name: "Goodreads",
    value: `[View on Goodreads](${best.goodreadsUrl})`,
    inline: false,
  });

  const embed = {
    title: "✅ Book Added",
    color: EMBED_COLOR,
    thumbnail: best.thumbnail ? { url: best.thumbnail } : undefined,
    fields,
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

  await Promise.all([
    clearRatings(targetId),
    clearVoteFor(targetId),
    clearCurrentIfMatches(targetId),
  ]);

  return res.json(ephemeralResponse("Book removed from the reading list."));
}

async function clearVoteFor(bookId: string): Promise<void> {
  const votes = await getVotes();
  let changed = false;
  for (const userId of Object.keys(votes)) {
    if (votes[userId] === bookId) {
      delete votes[userId];
      changed = true;
    }
  }
  if (changed) await setVotes(votes);
}

async function clearCurrentIfMatches(bookId: string): Promise<void> {
  const current = await getCurrent();
  if (current === bookId) await clearCurrent();
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

async function handleRate(
  res: VercelResponse,
  userId: string,
  bookId: string | null,
  score: number
) {
  if (!Number.isInteger(score) || score < 1 || score > 100) {
    return res.json(
      ephemeralResponse("Score must be an integer from 1 to 100.")
    );
  }

  // Default to the currently-reading book when no book is specified
  let targetId = bookId;
  if (!targetId) {
    targetId = await getCurrent();
    if (!targetId) {
      return res.json(
        ephemeralResponse(
          "No currently-reading book is set. Either pass `book:` or use `/current` to set one."
        )
      );
    }
  }

  const books = await getBooks();
  const book = books.find((b) => b.id === targetId);
  if (!book) {
    return res.json(
      ephemeralResponse(
        "That book is no longer in the reading list. Use `/books` to see current options."
      )
    );
  }

  await setRating(targetId, userId, score);
  const ratings = await getRatings();
  const summary = summarize(ratings, targetId)!;

  return res.json(
    ephemeralResponse(
      `⭐ Rated **${book.title}** ${score}/100. Average is now ${summary.average}/100 (${summary.count} rating${
        summary.count === 1 ? "" : "s"
      }).`
    )
  );
}

async function handleCurrent(res: VercelResponse, bookId: string | null) {
  if (!bookId) {
    const currentId = await getCurrent();
    if (!currentId) {
      return res.json(
        ephemeralResponse(
          "Nothing is currently being read. Use `/current book:<title>` to set one."
        )
      );
    }
    const books = await getBooks();
    const book = books.find((b) => b.id === currentId);
    if (!book) {
      return res.json(
        ephemeralResponse(
          "Currently reading is set to a book that's no longer in the list."
        )
      );
    }
    return res.json(
      ephemeralResponse(
        `📖 Currently reading: **${book.title}** by ${book.author}`
      )
    );
  }

  const books = await getBooks();
  const book = books.find((b) => b.id === bookId);
  if (!book) {
    return res.json(
      ephemeralResponse(
        "That book is no longer in the reading list. Use `/books` to see current options."
      )
    );
  }

  await setCurrent(bookId);
  return res.json(
    ephemeralResponse(
      `📖 Now reading: **${book.title}** by ${book.author}`
    )
  );
}

async function handleClearCurrent(res: VercelResponse) {
  await clearCurrent();
  return res.json(ephemeralResponse("Cleared currently-reading status."));
}

async function handleFinish(res: VercelResponse, bookId: string) {
  const books = await getBooks();
  const book = books.find((b) => b.id === bookId);
  if (!book) {
    return res.json(
      ephemeralResponse(
        "That book is no longer in the reading list. Use `/books` to see current options."
      )
    );
  }

  // Move from books -> archived (keep ratings as historical record)
  await addToArchive(book);
  await removeBook(bookId);
  await Promise.all([clearVoteFor(bookId), clearCurrentIfMatches(bookId)]);

  return res.json(
    ephemeralResponse(
      `✅ Finished **${book.title}**. Moved to archive — see \`/archive\`.`
    )
  );
}

async function handleArchive(res: VercelResponse) {
  const [archive, ratings] = await Promise.all([getArchive(), getRatings()]);

  if (archive.length === 0) {
    return res.json(
      ephemeralResponse(
        "No archived books yet. Use `/finish` after you've read one."
      )
    );
  }

  const sorted = [...archive].sort((a, b) =>
    b.finishedAt.localeCompare(a.finishedAt)
  );

  const fields = sorted.slice(0, 25).map((book) => {
    const finished = formatFinishedDate(book.finishedAt);
    const summary = summarize(ratings, book.id);
    const ratingLine = summary
      ? `⭐ ${summary.average}/100 (${summary.count} rating${
          summary.count === 1 ? "" : "s"
        })`
      : "No ratings";

    return {
      name: book.title,
      value: [
        `by **${book.author}**`,
        `Finished: ${finished}`,
        ratingLine,
      ].join("\n"),
      inline: false,
    };
  });

  const embed = {
    title: "📚 Archive",
    color: EMBED_COLOR,
    fields,
    footer: {
      text: `${archive.length} book${archive.length === 1 ? "" : "s"} finished`,
    },
  };

  return res.json(embedResponse(embed));
}

function formatFinishedDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
