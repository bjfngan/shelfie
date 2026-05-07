import { Redis } from "@upstash/redis";

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const KV_KEY = "ratings";

// bookId -> userId -> score (1..100)
export type RatingsMap = Record<string, Record<string, number>>;

export async function getRatings(): Promise<RatingsMap> {
  const ratings = await kv.get<RatingsMap>(KV_KEY);
  return ratings ?? {};
}

export async function setRating(
  bookId: string,
  userId: string,
  score: number
): Promise<void> {
  const ratings = await getRatings();
  if (!ratings[bookId]) ratings[bookId] = {};
  ratings[bookId][userId] = score;
  await kv.set(KV_KEY, ratings);
}

export async function clearRatings(bookId: string): Promise<void> {
  const ratings = await getRatings();
  if (!ratings[bookId]) return;
  delete ratings[bookId];
  await kv.set(KV_KEY, ratings);
}

export interface RatingSummary {
  average: number; // rounded integer
  count: number;
}

export function summarize(
  ratings: RatingsMap,
  bookId: string
): RatingSummary | null {
  const entry = ratings[bookId];
  if (!entry) return null;
  const scores = Object.values(entry);
  if (scores.length === 0) return null;
  const sum = scores.reduce((a, b) => a + b, 0);
  return { average: Math.round(sum / scores.length), count: scores.length };
}
