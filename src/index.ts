require("dotenv").config();
import { RedisTimeSeries } from "redis-modules-sdk";
import { URL } from "url";
import { createRedisStore, RedisStore } from "./redis";
import { collectMidpoint } from "./orderbook";
import {
  assets,
  constants,
  events,
  Exchange,
  Network,
  types,
  utils,
} from "@zetamarkets/sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import express from "express";
import cors from "cors";
import { resolutions } from "./time";
import { CandleList, CandleRow, LineRow } from "./interfaces";

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
let feedNameMap = new Map<constants.Asset, string>();

function candleListToCandleRows(candles: CandleList): CandleRow[] {
  let rows = [];
  for (let i = 0; i < candles.start.length; i++) {
    const row = {
      time: candles.start[i],
      open: candles.open[i],
      high: candles.high[i],
      low: candles.low[i],
      close: candles.close[i],
    };
    rows.push(row);
  }
  return rows;
}

function candleListToLineRows(candles: CandleList): LineRow[] {
  let rows = [];
  for (let i = 0; i < candles.start.length; i++) {
    const row = {
      time: candles.start[i],
      value: candles.close[i],
    };
    rows.push(row);
  }
  return rows;
}

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
	console.log(`[${asset}] Overriding midpoint with mark price. bidsLen=${orderbook.bids.length} asksLen=${orderbook.asks.length} now=${Date.now()/1000} updateTs=${Exchange.pricing.updateTimestamps[assets.assetToIndex(asset)].toNumber()}`);
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

      collectMidpoint(
        storeMap.get(asset)!,
        midpoint,
        feedNameMap.get(asset)!,
        retention
      );
    })
  );
  console.log();
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
      feedNameMap.set(asset, `${assets.assetToName(asset)}-PERP`);
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

// Express App
const app = express();
app.use(cors());

app.get("/tv/config", async (req, res) => {
  const response = {
    supported_resolutions: Object.keys(resolutions),
    supports_group_request: false,
    supports_marks: false,
    supports_search: true,
    supports_timescale_marks: false,
  };
  res.set("Cache-control", "public, max-age=360");
  res.send(response);
});

app.get("/tv/symbols", async (req, res) => {
  const symbol = req.query.symbol as string;
  const response = {
    name: symbol,
    ticker: symbol,
    description: symbol,
    type: "Perps",
    session: "24x7",
    exchange: "Zeta",
    listed_exchange: "Zeta",
    timezone: "Etc/UTC",
    has_intraday: true,
    supported_resolutions: Object.keys(resolutions),
    minmov: 1,
    pricescale: 100,
    has_seconds: true,
  };
  res.set("Cache-control", "public, max-age=360");
  res.send(response);
});

app.get("/tv/history", async (req, res) => {
  // parse
  const marketName = req.query.symbol as string;
  let asset = constants.Asset.UNDEFINED;
  try {
    asset = assets.nameToAsset(marketName.replace("-PERP", ""));
  } catch (_e) {}
  const resolution = resolutions[req.query.resolution as string] as number;
  let from = parseInt(req.query.from as string) * 1000;
  let to = parseInt(req.query.to as string) * 1000;
  const chartType = req.query.type || "candle";

  // validate
  const validSymbol = assets.allAssets().includes(asset);
  const validResolution = resolution != undefined;
  const validFrom = true || new Date(from).getFullYear() >= 2021;
  if (!(validSymbol && validResolution && validFrom)) {
    const error = { s: "error", validSymbol, validResolution, validFrom };
    console.error({ marketName, error });
    res.status(404).send(error);
    return;
  }

  // respond
  try {
    const store = new RedisStore(client, marketName);

    // snap candle boundaries to exact hours
    from = Math.floor(from / resolution) * resolution;
    to = Math.ceil(to / resolution) * resolution;

    // ensure the candle is at least one period in length
    if (from == to) {
      to += resolution;
    }
    const candles = await store.loadCandles(resolution, from, to);

    let response = {};
    switch (chartType) {
      case "candle":
        // code block
        response = {
          s: "ok",
          t: candles.start,
          o: candles.open,
          h: candles.high,
          l: candles.low,
          c: candles.close,
          // v: candles.map((c) => c.volume),
        };
        break;
      case "candle-lw":
        // code block
        response = candleListToCandleRows(candles);
        break;
      case "line-lw":
        // code block
        response = candleListToLineRows(candles);
        break;
      default:
        // If the chart type is not recognised throw an error
        throw new Error("`chartType` is not a valid chart type");
    }
    res.set("Cache-control", "public, max-age=1");
    res.send(response);
    return;
  } catch (e: any) {
    console.error({ req, e });

    // Redis issue - crash
    if (e.message.toString().includes("Connection is closed")) {
      console.log("Purposely crashing");
      process.exit(0);
    }

    const error = { s: "error" };
    res.status(500).send(error);
  }
});

app.get("/tv/recentprices", async (req, res) => {
  // this function is primarily for debugging purposes
  const marketName = req.query.symbol as string;

  // respond
  try {
    try {
      const store = new RedisStore(client, marketName);

      const recentPrices = await store.loadRecentPrices();
      res.send(recentPrices);
      return;
    } finally {
    }
  } catch (e) {
    console.error({ req, e });
    const error = { s: "error" };
    res.status(500).send(error);
  }
});

const httpPort = parseInt(process.env.PORT || "5000");
app.listen(httpPort);

main(client);
