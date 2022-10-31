import { RedisConfig, RedisStore, createRedisStore } from "./redis";

export async function collectMidpoint(
  store: RedisStore,
  midpoint: number,
  feedName: string
) {
  const ts = Date.now();
  console.log(`[${feedName}] ${midpoint}`);
  await store.client.add(feedName, ts.toString(), midpoint.toString());
}
