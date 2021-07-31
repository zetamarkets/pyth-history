import { Connection, PublicKey } from "@solana/web3.js";
import { PricefeedConfig, PriceData } from "./interfaces";
import { parsePriceData } from "@pythnetwork/client";
import { RedisConfig, RedisStore, createRedisStore } from "./redis";
import { sleep } from "./time";

async function fetchPriceData(
  connection: Connection,
  pricefeedPk: PublicKey
): Promise<PriceData> {
  // TODO: change to connection.onAccountChange for streaming
  const accountInfo = await connection.getAccountInfo(pricefeedPk);

  if (accountInfo === null) {
    throw new Error(`Account for pricefeed not found`);
  }
  const { price, confidence, status } = parsePriceData(accountInfo.data);
  console.log(`$${price} \xB1$${confidence}`);
  const ts = Date.now();
  return { price, confidence, ts, status };
}

export async function collectPricefeed(p: PricefeedConfig, r: RedisConfig) {
  // Create a new redis store for this pricefeed
  console.log(p.pricefeedName);

  const store = await createRedisStore(r, p.pricefeedName);
  const pricefeedAddress = new PublicKey(p.pricefeedPk);
  const connection = new Connection(p.clusterUrl);

  while (true) {
    try {
      const priceData = await fetchPriceData(connection, pricefeedAddress);
      console.log(priceData);

      store.storePrice(priceData);
    } catch (e) {
      console.error(p.pricefeedName, (e as Error).toString());
    }
    await sleep({
      Millis: 400,
    });
  }
}
