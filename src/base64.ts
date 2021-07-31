import { Candle, PriceData, Coder } from "./interfaces";

export class Base64TradeCoder implements Coder<PriceData> {
  constructor() {}

  encode(p: PriceData): string {
    const buf = Buffer.alloc(15);
    buf.writeFloatLE(p.price, 0);
    buf.writeFloatLE(p.confidence, 4);
    buf.writeUIntLE(p.ts, 8, 6);
    buf.writeUInt8(p.status, 14);
    const base64 = buf.toString("base64");
    return base64;
  }

  decode(s: string): PriceData {
    const buf = Buffer.from(s, "base64");
    const data = {
      price: buf.readFloatLE(0),
      confidence: buf.readFloatLE(4),
      ts: buf.readUIntLE(8, 6),
      status: buf.readUInt8(14),
    };
    return data;
  }
}

export class Base64CandleCoder implements Coder<Candle> {
  constructor() {}

  encode(c: Candle): string {
    const buf = Buffer.alloc(36);
    buf.writeFloatLE(c.open, 0);
    buf.writeFloatLE(c.close, 4);
    buf.writeFloatLE(c.high, 8);
    buf.writeFloatLE(c.low, 12);
    buf.writeUIntLE(c.start, 16, 6);
    buf.writeUIntLE(c.end, 22, 6);
    const base64 = buf.toString("base64");
    return base64;
  }

  decode(s: string): Candle {
    const buf = Buffer.from(s, "base64");
    const candle = {
      open: buf.readFloatLE(0),
      close: buf.readFloatLE(4),
      high: buf.readFloatLE(8),
      low: buf.readFloatLE(12),
      start: buf.readUIntLE(16, 6),
      end: buf.readUIntLE(22, 6),
    };
    return candle;
  }
}
