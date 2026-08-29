import { assertDurableData } from "../persistence/schema.js";

function orderValue(value) {
  if (Array.isArray(value)) return value.map(orderValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, orderValue(value[key])]));
  }
  return value;
}

/** Serialize durable data with recursively sorted object keys and stable arrays. */
export function canonicalJson(value) {
  assertDurableData(value, "Portable JSON");
  return JSON.stringify(orderValue(value));
}

export function canonicalJsonBytes(value) {
  return new TextEncoder().encode(canonicalJson(value));
}
