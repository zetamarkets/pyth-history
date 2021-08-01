require("dotenv").config();
import cors from "cors";
import express from "express";
import { Tedis, TedisPool } from "tedis";
import { URL } from "url";
import { PricefeedConfig } from "./interfaces";
import { RedisStore } from "./redis";
import { resolutions, sleep } from "./time";
import { collectPricefeed } from "./oracle";

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
const max_conn = parseInt(process.env.REDIS_MAX_CONN || "") || 200;
const redisConfig = { host, port, password, db: 0, max_conn };
const pool = new TedisPool(redisConfig);

// Solana web3 config
const network = "devnet";
const clusterUrl =
  process.env.RPC_ENDPOINT_URL || "https://api.devnet.solana.com";

// Oracle config (devnet)
const pricefeeds: Record<string, string> = {
  "SOL/USD": "J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix",
};

Object.entries(pricefeeds).forEach((pricefeed) => {
  const [pricefeedName, pricefeedPk] = pricefeed;
  const pc = {
    clusterUrl,
    pricefeedName,
    pricefeedPk,
  } as PricefeedConfig;
  collectPricefeed(pc, { host, port, password, db: 0 });
});

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
    type: "Spot",
    session: "24x7",
    exchange: "Pyth",
    listed_exchange: "Pyth",
    timezone: "Etc/UTC",
    has_intraday: true,
    supported_resolutions: Object.keys(resolutions),
    minmov: 1,
    pricescale: 100,
  };
  res.set("Cache-control", "public, max-age=360");
  res.send(response);
});

app.get("/tv/history", async (req, res) => {
  // parse
  const marketName = req.query.symbol as string;
  const marketPk = pricefeeds[marketName];
  const resolution = resolutions[req.query.resolution as string] as number;
  let from = parseInt(req.query.from as string) * 1000;
  let to = parseInt(req.query.to as string) * 1000;

  // validate
  const validSymbol = marketPk != undefined;
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
    const conn = await pool.getTedis();
    try {
      const store = new RedisStore(conn, marketName);

      // snap candle boundaries to exact hours
      from = Math.floor(from / resolution) * resolution;
      to = Math.ceil(to / resolution) * resolution;

      // ensure the candle is at least one period in length
      if (from == to) {
        to += resolution;
      }
      const candles = await store.loadCandles(resolution, from, to);
      const response = {
        s: "ok",
        t: candles.map((c) => c.start / 1000),
        c: candles.map((c) => c.close),
        o: candles.map((c) => c.open),
        h: candles.map((c) => c.high),
        l: candles.map((c) => c.low),
        // v: candles.map((c) => c.volume),
      };
      res.set("Cache-control", "public, max-age=1");
      res.send(response);
      return;
    } finally {
      pool.putTedis(conn);
    }
  } catch (e) {
    console.error({ req, e });
    const error = { s: "error" };
    res.status(500).send(error);
  }
});

const httpPort = parseInt(process.env.PORT || "5000");
app.listen(httpPort);
