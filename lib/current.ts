import { Redis } from "@upstash/redis";

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const KV_KEY = "current";

export async function getCurrent(): Promise<string | null> {
  return (await kv.get<string>(KV_KEY)) ?? null;
}

export async function setCurrent(bookId: string): Promise<void> {
  await kv.set(KV_KEY, bookId);
}

export async function clearCurrent(): Promise<void> {
  await kv.del(KV_KEY);
}
