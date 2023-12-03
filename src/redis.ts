import { RedisTimeSeries, TSAggregationType } from "redis-modules-sdk";

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
}

export class RedisStore {
  client: RedisTimeSeries;
  symbol: string;

  constructor(client: RedisTimeSeries, symbol: string) {
    this.client = client;
    this.symbol = symbol;
  }

  async storeData(
    value: number,
    feedName: string,
    ts: number,
    retention: number // milliseconds
  ) {
    await this.client.add(feedName, ts.toString(), value.toString(), {
      retention: retention,
      onDuplicate: "LAST",
    });
  }
}

export async function createRedisStore(
  config: RedisConfig,
  symbol: string
): Promise<RedisStore> {
  const client = new RedisTimeSeries({
    host: config.host,
    port: config.port,
    password: config.password,
  });
  // Connect to the Redis database with RedisTimeSeries module
  await client.connect();
  return new RedisStore(client, symbol);
}
