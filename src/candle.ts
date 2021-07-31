
import { Candle, PriceData } from "./interfaces";


export function batch(ts: PriceData[], start: number, end: number): Candle | undefined {

  const batchTrades = ts.filter(t => t.ts >= start && t.ts < end);

  if (batchTrades.length == 0) {
    return undefined;
  } else {
    let t0 = batchTrades[0];
    let c = { open: t0.price,
              close: t0.price,
              high: t0.price,
              low: t0.price,
              start, end };

    batchTrades.slice(1).forEach(t => {
      c.close = t.price;
      c.high = Math.max(c.high, t.price);
      c.low = Math.min(c.low, t.price);
    });

    return c;
  }
}
