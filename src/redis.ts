import { CandleList, CandleStore } from "./interfaces";
import { PriceData } from "@pythnetwork/client";
import { RedisTimeSeries, TSAggregationType } from "redis-modules-sdk";

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
}

export class RedisStore implements CandleStore {
  client: RedisTimeSeries;
  symbol: string;

  constructor(client: RedisTimeSeries, symbol: string) {
    this.client = client;
    this.symbol = symbol;
  }

  async storePrice(p: PriceData, ts: number): Promise<void> {
    if (p.price !== undefined) {
      await this.client.add(
        `${this.symbol}-Price`,
        ts.toString(),
        p.price.toString(),
        { onDuplicate: "FIRST" }
      );
    }
  }

  async storeConfidence(p: PriceData, ts: number): Promise<void> {
    if (p.confidence !== undefined) {
      await this.client.add(
        `${this.symbol}-Confidence`,
        ts.toString(),
        p.confidence.toString(),
        { onDuplicate: "FIRST" }
      );
    }
  }

  async loadCandles(
    resolution: number,
    from: number,
    to: number
  ): Promise<CandleList> {
    // Map aggregations across data
    const aggregations = ["first", "max", "min", "last"];
    const agg_results = aggregations.map((agg) => {
      // Range from-to is inclusive
      // @ts-ignore
      const result: Promise<number[][]> = this.client.range(
        `${this.symbol}-Price`,
        from.toString(),
        to.toString(),
        {
          aggregation: {
            type: agg as TSAggregationType,
            timeBucket: resolution,
          },
        }
      );
      return result;
    });
    const [o, h, l, c] = await Promise.all(agg_results);
    const ohlc: CandleList = {
      open: o.map((x) => x[1]),
      high: h.map((x) => x[1]),
      low: l.map((x) => x[1]),
      close: c.map((x) => x[1]),
      start: o.map((x) => x[0] / 1000),
    };
    return ohlc;
  }

  async loadRecentPrices(): Promise<number[]> {
    const today = Date.now();
    const yesterday = today - 24 * 60 * 60 * 1000;
    const prices = this.client.range(
      `${this.symbol}-Price`,
      yesterday.toString(),
      today.toString(),
      { aggregation: { type: "avg", timeBucket: 1000 * 60 } }
    );
    return prices;
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
