require("dotenv").config();
import { RedisTimeSeries } from "redis-modules-sdk";
import { URL } from "url";
import { createRedisStore, RedisStore } from "./redis";
import {
  assets,
  constants,
  Decimal,
  Exchange,
  Network,
  types,
  utils,
} from "@zetamarkets/sdk";
import { Connection } from "@solana/web3.js";

// Adds timestamp to the start of each log, including modules
require("log-timestamp")(function () {
  return `[${new Date().toUTCString()}]`;
});

// Redis config
const redisUrl = new URL(
  process.env.REDISCLOUD_URL || "redis://localhost:6379"
);

// Retention time in milliseconds
const retention = process.env.RETENTION_TIME
  ? parseInt(process.env.RETENTION_TIME)
  : 7889400000; // 3 months

const host = redisUrl.hostname;
const port = parseInt(redisUrl.port);
let password: string | undefined;
if (redisUrl.password !== "") {
  password = redisUrl.password;
}
const redisConfig = { host, port, password };
const client = new RedisTimeSeries(redisConfig, { isHandleError: false });

// Solana web3 config
const connection: Connection = new Connection(
  process.env.RPC_ENDPOINT_URL!,
  "confirmed"
);

let storeMap = new Map<constants.Asset, RedisStore>();

async function readMidpoints() {
  await Exchange.updateZetaPricing();
  await Promise.all(
    Exchange.assets.map(async (asset) => {
      let midpoint = 0;

      if (!Exchange.isSetup) return;
      let orderbook = Exchange.getOrderbook(asset);
      let markPrice = Exchange.oracle.getPrice(asset).price;
      console.log(`[${asset}] markPrice=${markPrice}`);

      // If the orderbook is empty just grab the oracle price so we don't have gaps
      // Timeout check is useful to prevent staleness in halt situations
      if (
        orderbook.bids.length < 1 ||
        orderbook.asks.length < 1 ||
        Date.now() / 1000 -
          Exchange.pricing.updateTimestamps[
            assets.assetToIndex(asset)
          ].toNumber() >
          120
      ) {
        console.log(
          `[${asset}] Overriding midpoint with mark price. bidsLen=${
            orderbook.bids.length
          } asksLen=${orderbook.asks.length} now=${
            Date.now() / 1000
          } updateTs=${Exchange.pricing.updateTimestamps[
            assets.assetToIndex(asset)
          ].toNumber()}`
        );
        midpoint = markPrice;
      } else {
        midpoint = (orderbook.asks[0].price + orderbook.bids[0].price) / 2;
        console.log(`[${asset}] Orderbook midpoint = ${midpoint}`);
        // clamp to maximum 0.5% away from oracle
        midpoint = Math.max(
          0.995 * markPrice,
          Math.min(midpoint, 1.005 * markPrice)
        );
      }

      const feedName = `${assets.assetToName(asset)}-PERP`;
      const ts = Date.now();
      console.log(`[${feedName}] midpoint=${midpoint} ts=${ts}`);
      storeMap.get(asset)!.storeData(midpoint, feedName, ts, retention);
    })
  );
  console.log();
}

async function readFunding() {
  await Exchange.updateZetaPricing();
  await Promise.all(
    Exchange.assets.map(async (asset) => {
      let funding =
        Decimal.fromAnchorDecimal(
          Exchange.pricing.latestFundingRates[assets.assetToIndex(asset)]
        ).toNumber() * Math.pow(10, 2);

      const feedName = `${assets.assetToName(asset)}-FUNDING`;
      const ts = Date.now();
      console.log(`[${feedName}] funding=${funding} ts=${ts}`);
      storeMap.get(asset)!.storeData(funding, feedName, ts, retention);
    })
  );
}

async function main(client: RedisTimeSeries) {
  try {
    console.log("Connecting to redis client...");
    await client.connect();

    for (var asset of assets.allAssets()) {
      storeMap.set(
        asset,
        await createRedisStore(redisConfig, assets.assetToName(asset)!)
      );
    }

    console.log("Loading Zeta Exchange...");
    const loadExchangeConfig = types.defaultLoadExchangeConfig(
      Network.MAINNET,
      connection,
      utils.defaultCommitment(),
      undefined,
      true
    );

    await Exchange.load(loadExchangeConfig);

    setInterval(
      async function () {
        readMidpoints();
      },
      process.env.READ_MIDPOINT_INTERVAL
        ? parseInt(process.env.READ_MIDPOINT_INTERVAL)
        : 1000
    );

    setInterval(
      async function () {
        readFunding();
      },
      process.env.READ_FUNDING_INTERVAL
        ? parseInt(process.env.READ_FUNDING_INTERVAL)
        : 10000
    );

    // Easier than reloading the exchange as most of the startup time is exchange loading anyway
    // `forever` will catch this and restart automatically
    setInterval(async () => {
      throw new Error("Scheduled daily restart");
    }, 86_400_000); // 24 hours
  } catch (e) {
    console.error(e);
    client.disconnect();
  }
}

main(client);
