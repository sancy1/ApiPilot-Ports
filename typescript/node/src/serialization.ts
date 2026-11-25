// filepath: src/serialization.ts
// layer: Serialization | package: @apipilot/node | since: v0.1.0
// purpose: JSON serialization modes — mirrors ApiPilot.AspNetCore.Serialization (C#).
// -----------------------------------------------------------------------------

import type { JsonOptions } from "./options.js";

export type NamingPolicy = "camelCase" | "snake_case" | "passthrough";

function toCamelCase(key: string): string {
  if (key.length === 0) return key;
  let i = 0;
  while (i < key.length && key[i]! >= "A" && key[i]! <= "Z") i++;
  if (i > 1 && i < key.length && key[i]! >= "a" && key[i]! <= "z") i--;
  return key.slice(0, i).toLowerCase() + key.slice(i);
}

function toSnakeCase(key: string): string {
  let out = "";
  for (let i = 0; i < key.length; i++) {
    const ch = key[i]!;
    if (ch >= "A" && ch <= "Z") {
      if (i > 0) out += "_";
      out += ch.toLowerCase();
    } else {
      out += ch;
    }
  }
  return out;
}

export function applyNamingPolicy(key: string, policy: NamingPolicy): string {
  if (policy === "snake_case") return toSnakeCase(key);
  if (policy === "passthrough") return key;
  return toCamelCase(key);
}

/** Marker for enum-like values serialized per enumMode. */
export interface ApiEnumValue {
  readonly __apipilotEnum: true;
  readonly name: string;
  readonly value: number | string;
}

/** Wraps an enum-like value for ApiPilot serialization. */
export function enumValue(name: string, value: number | string): ApiEnumValue {
  return { __apipilotEnum: true, name, value };
}

function isEnumValue(v: unknown): v is ApiEnumValue {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Record<string, unknown>).__apipilotEnum === true
  );
}

function transformDate(d: Date, dateMode: string): number | string {
  if (dateMode === "unixSeconds") return Math.floor(d.getTime() / 1000);
  if (dateMode === "unixMs") return d.getTime();
  return d.toISOString();
}

/**
 * Recursively transforms a data payload per JsonOptions.
 * Envelope keys are never passed through here — callers transform `data`
 * before wrapping it in an envelope.
 */
export function transformData(data: unknown, options: JsonOptions): unknown {
  if (data === null || data === undefined) return data ?? null;
  if (data instanceof Date) return transformDate(data, options.dateMode);
  if (isEnumValue(data)) {
    return options.enumMode === "number" ? data.value : data.name;
  }
  if (Array.isArray(data)) {
    return data.map((item) => transformData(item, options));
  }
  if (typeof data === "object") {
    const out: Record<string, unknown> = {};
    const policy = options.namingPolicy ?? "camelCase";
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (options.ignoreNulls === true && v === null) continue;
      out[applyNamingPolicy(k, policy)] = transformData(v, options);
    }
    return out;
  }
  return data;
}
