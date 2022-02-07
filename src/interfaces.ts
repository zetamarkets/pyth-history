import BN from "bn.js";
import { PriceData } from "@pythnetwork/client";

export interface PricefeedConfig {
  clusterUrl: string;
  pricefeedName: string;
  pricefeedPk: string;
}

export interface Coder<T> {
  encode: (t: T) => string;
  decode: (s: string) => T;
}

export interface CandleList {
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  start: number[];
}

export interface CandleRow {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface LineRow {
  time: number;
  value: number;
}

export interface CandleStore {
  storePrice: (p: PriceData, ts: number) => Promise<void>;
  loadCandles: (
    resolution: number,
    from: number,
    to: number
  ) => Promise<CandleList>;
}

export interface BufferStore {
  storeBuffer: (ts: number, b: Buffer) => Promise<void>;
}

export interface KeyValStore {
  storeNumber: (key: string, val: number) => Promise<void>;
  loadNumber: (key: string) => Promise<number | undefined>;
}
