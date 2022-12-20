import { RedisConfig, RedisStore, createRedisStore } from "./redis";

export async function collectMidpoint(
  store: RedisStore,
  midpoint: number,
  feedName: string,
  retention: number // milliseconds
) {
  const ts = Date.now();
  console.log(`[${feedName}] midpoint=${midpoint} ts=${ts}`);
  await store.client.add(feedName, ts.toString(), midpoint.toString(), {
    retention: retention,
  });
}
