/**
 * Quarantine reader. Untrusted content (invoices, quotes, token metadata, tool
 * output, messages from anyone but the owner) is turned into a small schema of
 * typed fields with provenance "untrusted" and an injection flag. The planner
 * receives only the id and field names. Decoding is done here too, and
 * decoded text is tagged "decoded" so it can never fill an intent slot.
 * [CaMeL] [Willison-Trifecta] [INC-GROK-BANKR]
 */
import { randomUUID } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { scanForInjection, type UntrustedInput } from "@mandate/core";
import type { Db } from "./db.js";

export interface QuarantinedFields {
  amount?: string; // decimal string in token units as written
  payTo?: string;
  memo?: string;
  token?: string;
}

export interface QuarantineItem {
  id: string;
  kind: UntrustedInput["kind"];
  origin: string;
  fields: QuarantinedFields;
  suspectedInjection: boolean;
  matches: string[];
  decodedLayers: string[];
  createdAt: string;
}

export function parseUntrusted(text: string): QuarantinedFields {
  const out: QuarantinedFields = {};
  const addr = text.match(/0x[0-9a-fA-F]{40}/)?.[0];
  if (addr && isAddress(addr, { strict: false })) out.payTo = getAddress(addr);
  const amt =
    text.match(/(?:amount|total|due|pay)\s*[:=]?\s*\$?\s*(\d+(?:\.\d+)?)\s*(usdc|eth|weth)?/i) ??
    text.match(/(\d+(?:\.\d+)?)\s*(usdc|eth|weth)\b/i);
  if (amt && amt[1]) {
    out.amount = amt[1];
    if (amt[2]) out.token = amt[2].toUpperCase();
  }
  const memo = text.match(/(?:memo|ref|reference|description)\s*[:=]\s*([^\n]{1,80})/i)?.[1];
  if (memo) out.memo = memo.trim();
  return out;
}

export class Quarantine {
  constructor(private readonly db: Db) {}

  ingest(kind: UntrustedInput["kind"], origin: string, text: string): QuarantineItem {
    const scan = scanForInjection(text);
    const item: QuarantineItem = {
      id: `q_${randomUUID().slice(0, 8)}`,
      kind,
      origin,
      fields: parseUntrusted(text),
      suspectedInjection: scan.suspected,
      matches: scan.matches,
      decodedLayers: scan.decodedLayers,
      createdAt: new Date().toISOString(),
    };
    this.db.insertQuarantine({
      id: item.id,
      kind,
      origin,
      text,
      parsed_json: JSON.stringify(item.fields),
      suspected: scan.suspected ? 1 : 0,
      matches_json: JSON.stringify({ matches: scan.matches, decodedLayers: scan.decodedLayers }),
      created_at: item.createdAt,
    });
    return item;
  }

  get(id: string): (QuarantineItem & { text: string }) | undefined {
    const row = this.db.getQuarantine(id);
    if (!row) return undefined;
    const mj = JSON.parse(row.matches_json) as { matches: string[]; decodedLayers: string[] };
    return {
      id: row.id,
      kind: row.kind as UntrustedInput["kind"],
      origin: row.origin,
      fields: JSON.parse(row.parsed_json) as QuarantinedFields,
      suspectedInjection: row.suspected === 1,
      matches: mj.matches,
      decodedLayers: mj.decodedLayers,
      createdAt: row.created_at,
      text: row.text,
    };
  }

  toUntrustedInput(item: QuarantineItem & { text: string }): UntrustedInput {
    return {
      id: item.id,
      kind: item.kind,
      origin: item.origin,
      text: item.text,
      suspectedInjection: item.suspectedInjection,
      matches: item.matches,
    };
  }
}
