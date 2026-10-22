import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { TextEncoder, TextDecoder } from "node:util";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: webcrypto,
});
Object.defineProperty(globalThis, "TextEncoder", {
  configurable: true,
  value: TextEncoder,
});
Object.defineProperty(globalThis, "TextDecoder", {
  configurable: true,
  value: TextDecoder,
});
afterEach(cleanup);
