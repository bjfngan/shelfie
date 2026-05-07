import type { VercelRequest, VercelResponse } from "@vercel/node";
import { InteractionType, verifyKey } from "discord-interactions";
import { addBook, getBooks, removeBook } from "../lib/books";
import { embedResponse, ephemeralResponse, EMBED_COLOR } from "../lib/discord";
import { searchBooks } from "../lib/googleBooks";

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

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const name: string = interaction.data.name;

    if (name === "books") {
      return handleBooks(res);
    }
    if (name === "add-book") {
      const query = getOption(interaction, "query") as string;
      return handleAddBook(res, query);
    }
    if (name === "remove-book") {
      const id = getOption(interaction, "id") as string;
      return handleRemoveBook(res, id);
    }
  }

  return res.status(400).send("Unknown interaction type");
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
  let results;
  try {
    results = await searchBooks(query);
  } catch {
    return res.json(
      ephemeralResponse("Failed to reach Google Books. Please try again.")
    );
  }

  if (results.length === 0) {
    return res.json(
      ephemeralResponse(
        `No books found for "${query}". Try a different title or author.`
      )
    );
  }

  const best = results[0];
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

async function handleRemoveBook(res: VercelResponse, bookId: string) {
  const removed = await removeBook(bookId);

  if (!removed) {
    return res.json(
      ephemeralResponse(
        `No book found with ID \`${bookId}\`. Use \`/books\` to see IDs.`
      )
    );
  }

  return res.json(ephemeralResponse("Book removed from the reading list."));
}
