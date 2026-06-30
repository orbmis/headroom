import { createHash } from "node:crypto";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export class DomainError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export function assertCondition(condition, code, message, details = {}) {
  if (!condition) {
    throw new DomainError(code, message, details);
  }
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashOf(value) {
  return `0x${createHash("sha3-256").update(stableStringify(value)).digest("hex")}`;
}

export function sum(values) {
  return values.reduce((acc, value) => acc + value, 0);
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function bpsToPercent(bps) {
  return `${(bps / 100).toFixed(2)}%`;
}

export function formatAmount(amount) {
  return `${amount.toLocaleString("en-US")} mock USDC`;
}

export function sortObjectByKey(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)));
}

export function mapValues(object, fn) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, fn(value, key)]));
}

export function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}
