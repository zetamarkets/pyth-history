import { Connection, PublicKey, Context, AccountInfo } from "@solana/web3.js";
import { PricefeedConfig, PriceData } from "./interfaces";
import { parsePriceData } from "@pythnetwork/client";
import { RedisConfig, RedisStore, createRedisStore } from "./redis";

export async function collectPricefeed(p: PricefeedConfig, r: RedisConfig) {
  // Create a new redis store for this pricefeed
  const store = await createRedisStore(r, p.pricefeedName);
  const pricefeedAddress = new PublicKey(p.pricefeedPk);
  const connection = new Connection(p.clusterUrl);

  // Callback that fetches pricefeed data and stores in Redis
  async function priceDataCallback(
    accountInfo: AccountInfo<Buffer>,
    context: Context
  ) {
    const { price, confidence, status } = parsePriceData(accountInfo.data);
    console.log(`$${price} \xB1$${confidence}`);
    console.log(context.slot);
    const ts = Date.now();
    store.storePrice({ price, confidence, ts, status });
  }

  // Streaming approach: fetch price data on account change via ws
  connection.onAccountChange(pricefeedAddress, priceDataCallback);
}
