require("dotenv").config();
import cors from "cors";
import express from "express";
import { RedisTimeSeries } from "redis-modules-sdk";
import { URL } from "url";
import { PricefeedConfig } from "./interfaces";
import { RedisStore } from "./redis";
import { resolutions, sleep } from "./time";
import { collectPricefeed } from "./oracle";
import { CandleRow, LineRow, CandleList } from "./interfaces";

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
const clusterUrl =
  process.env.RPC_ENDPOINT_URL || "https://api.mainnet-beta.solana.com";

// Oracle config (mainnet)
const pricefeeds: Record<string, string> = {
  "SOL/USD": "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG",
};

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

async function main(
  client: RedisTimeSeries,
  pricefeeds: Record<string, string>
) {
  try {
    await client.connect();
    Object.entries(pricefeeds).forEach((pricefeed) => {
      const [pricefeedName, pricefeedPk] = pricefeed;
      const pc = {
        clusterUrl,
        pricefeedName,
        pricefeedPk,
      } as PricefeedConfig;
      collectPricefeed(pc, { host, port, password });
    });
  } catch (e) {
    console.error(e);
    client.disconnect();
  }
}

main(client, pricefeeds);

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
  const chartType = req.query.type || "candle";

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
  } catch (e) {
    console.error({ req, e });
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
