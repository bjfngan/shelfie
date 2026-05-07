import { Redis } from "@upstash/redis";

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export interface Book {
  id: string;
  title: string;
  author: string;
  pageCount: number | null;
  genres: string[];
  thumbnail: string | null;
  goodreadsUrl: string;
  addedAt: string;
}

const KV_KEY = "books";

export async function getBooks(): Promise<Book[]> {
  const books = await kv.get<Book[]>(KV_KEY);
  return books ?? [];
}

export async function addBook(book: Book): Promise<"added" | "duplicate"> {
  const books = await getBooks();
  if (books.some((b) => b.id === book.id)) return "duplicate";
  books.push(book);
  await kv.set(KV_KEY, books);
  return "added";
}

export async function removeBook(bookId: string): Promise<boolean> {
  const books = await getBooks();
  const filtered = books.filter((b) => b.id !== bookId);
  if (filtered.length === books.length) return false;
  await kv.set(KV_KEY, filtered);
  return true;
}
