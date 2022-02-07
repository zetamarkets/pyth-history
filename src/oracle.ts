import { Connection, PublicKey, Context, AccountInfo } from "@solana/web3.js";
import { PricefeedConfig } from "./interfaces";
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
    const priceData = parsePriceData(accountInfo.data);
    console.log(`$${priceData.price} \xB1$${priceData.confidence}`);
    console.log(context.slot);
    const ts = Date.now();
    store.storePrice(priceData, ts);
  }

  // Streaming approach: fetch price data on account change via ws
  connection.onAccountChange(pricefeedAddress, priceDataCallback);
}
