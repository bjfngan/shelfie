import { Redis } from "@upstash/redis";
import type { Book } from "./books";

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const KV_KEY = "archived";

export type ArchivedBook = Book & { finishedAt: string };

export async function getArchive(): Promise<ArchivedBook[]> {
  const archive = await kv.get<ArchivedBook[]>(KV_KEY);
  return archive ?? [];
}

export async function addToArchive(book: Book): Promise<void> {
  const archive = await getArchive();
  archive.push({ ...book, finishedAt: new Date().toISOString() });
  await kv.set(KV_KEY, archive);
}
