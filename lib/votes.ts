import { Redis } from "@upstash/redis";

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const KV_KEY = "votes";

// userId -> bookId
export type VoteMap = Record<string, string>;

export async function getVotes(): Promise<VoteMap> {
  const votes = await kv.get<VoteMap>(KV_KEY);
  return votes ?? {};
}

export async function castVote(userId: string, bookId: string): Promise<void> {
  const votes = await getVotes();
  votes[userId] = bookId;
  await kv.set(KV_KEY, votes);
}

export async function clearVotes(): Promise<number> {
  const votes = await getVotes();
  const count = Object.keys(votes).length;
  await kv.set(KV_KEY, {});
  return count;
}

// Returns [{ bookId, count }] sorted by count desc
export function tallyVotes(votes: VoteMap): { bookId: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const bookId of Object.values(votes)) {
    counts[bookId] = (counts[bookId] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([bookId, count]) => ({ bookId, count }))
    .sort((a, b) => b.count - a.count);
}
