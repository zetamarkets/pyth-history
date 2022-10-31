require("dotenv").config();
import { RedisTimeSeries } from "redis-modules-sdk";
import { URL } from "url";
import { createRedisStore, RedisStore } from "./redis";
import { collectMidpoint } from "./orderbook";
import { assets, events, Exchange, Network, utils } from "@zetamarkets/sdk";
import { Connection, PublicKey } from "@solana/web3.js";

// Redis config
const redisUrl = new URL(
  process.env.REDISCLOUD_URL || "redis://localhost:6379"
);
const host = redisUrl.hostname;
const port = parseInt(redisUrl.port);
let password: string | undefined;
if (redisUrl.password !== "") {
  password = redisUrl.password;
}
const redisConfig = { host, port, password };
const client = new RedisTimeSeries(redisConfig);

// Solana web3 config
const connection: Connection = new Connection(
  process.env.RPC_ENDPOINT_URL!,
  "confirmed"
);

let storeMap = new Map<assets.Asset, RedisStore>();
let currentMidpointMap = new Map<assets.Asset, number>();
let feedNameMap = new Map<assets.Asset, string>();

async function exchangeCallback(
  asset: assets.Asset,
  eventType: events.EventType,
  _data: any
) {
  if (eventType == events.EventType.GREEKS) {
    let midpoint = Exchange.getGreeks(asset).perpLatestMidpoint.toNumber();
    // Greeks can update independent of midpoint
    if (midpoint != currentMidpointMap.get(asset) && midpoint != 0) {
      collectMidpoint(storeMap.get(asset)!, midpoint, feedNameMap.get(asset)!);
      currentMidpointMap.set(asset, midpoint);
    }
  }
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
      currentMidpointMap.set(asset, 0);
      feedNameMap.set(asset, `${assets.assetToName(asset)}-PERP`);
    }

    console.log("Loading Zeta Exchange...");
    await Exchange.load(
      assets.allAssets(),
      new PublicKey(process.env.PROGRAM_ID!),
      process.env.NETWORK! == "devnet" ? Network.DEVNET : Network.MAINNET,
      connection,
      utils.defaultCommitment(),
      undefined,
      undefined,
      exchangeCallback
    );
  } catch (e) {
    console.error(e);
    client.disconnect();
  }
}

main(client);
