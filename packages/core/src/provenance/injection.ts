/**
 * Instruction-like pattern detector for untrusted content. It is a cheap
 * first filter, not a guarantee: the guarantee is that untrusted content can
 * never become an instruction, only a quoted field. [OWASP-LLM01] [INC-GROK-BANKR]
 */
export interface InjectionScan {
  suspected: boolean;
  matches: string[];
  decodedLayers: string[];
}

const INSTRUCTION_PATTERNS: { id: string; re: RegExp }[] = [
  {
    id: "ignore_previous",
    re: /\bignore\b.{0,40}\b(previous|prior|above|your|all)\b.{0,30}\b(instruction|rule|mandate|polic)/i,
  },
  {
    id: "override_mandate",
    re: /\b(override|bypass|disable|lift|raise)\b.{0,30}\b(mandate|cap|limit|polic|guard|check)/i,
  },
  {
    id: "send_everything",
    re: /\b(send|transfer|move|drain|sweep|withdraw)\b.{0,30}\b(all|everything|entire|whole|full)\b/i,
  },
  {
    id: "transfer_to_address",
    re: /\b(send|transfer|pay|move|route|forward)\b.{0,60}\b0x[0-9a-fA-F]{6,40}/i,
  },
  {
    id: "new_instructions",
    re: /\b(new|updated|revised)\s+(instruction|directive|order|rule)s?\b/i,
  },
  { id: "system_prompt", re: /\b(system prompt|developer message|assistant:|\[system\])/i },
  {
    id: "urgency",
    re: /\b(urgent|immediately|right now|asap|within the hour|before it expires)\b/i,
  },
  {
    id: "authority_claim",
    re: /\b(owner|admin|administrator|treasurer|ceo)\b.{0,40}\b(approved|authori[sz]ed|confirmed|said|told)\b/i,
  },
  {
    id: "tier_escalation",
    re: /\b(executive|admin|elevated|unlimited|god)\s*(tier|mode|level|permission|access)\b/i,
  },
  {
    id: "policy_update",
    re: /\b(policy|mandate|cap|limit)s?\s+(update|change|increase|raised|lifted)\b/i,
  },
  { id: "approve_max", re: /\bapprove\b.{0,30}\b(max|maximum|unlimited|infinite|uint256)\b/i },
  { id: "claim_reward", re: /\b(claim|unlock|redeem)\b.{0,30}\b(reward|airdrop|prize|bonus)\b/i },
  { id: "you_must", re: /\byou (must|need to|have to|should now|are required to)\b/i },
  { id: "to_claim", re: /\bto claim\b/i },
];

// a run of at least eight Morse symbols separated by spaces or word separators
const MORSE_RE = /(?:[.\-\u2010-\u2015]{1,7}(?:\s+|\s*[/|]\s*)){7,}[.\-\u2010-\u2015]{1,7}/;
const BASE64_RE = /(?:[A-Za-z0-9+/]{4}){8,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g;
const HEX_TEXT_RE = /(?:0x)?(?:[0-9a-fA-F]{2}){16,}/g;

const MORSE_TABLE: Record<string, string> = {
  ".-": "a",
  "-...": "b",
  "-.-.": "c",
  "-..": "d",
  ".": "e",
  "..-.": "f",
  "--.": "g",
  "....": "h",
  "..": "i",
  ".---": "j",
  "-.-": "k",
  ".-..": "l",
  "--": "m",
  "-.": "n",
  "---": "o",
  ".--.": "p",
  "--.-": "q",
  ".-.": "r",
  "...": "s",
  "-": "t",
  "..-": "u",
  "...-": "v",
  ".--": "w",
  "-..-": "x",
  "-.--": "y",
  "--..": "z",
  "-----": "0",
  ".----": "1",
  "..---": "2",
  "...--": "3",
  "....-": "4",
  ".....": "5",
  "-....": "6",
  "--...": "7",
  "---..": "8",
  "----.": "9",
};

export function decodeMorse(text: string): string {
  return text
    .replace(/[‐-―]/g, "-")
    .trim()
    .split(/\s*[/|]\s*|\s{2,}/)
    .map((word) =>
      word
        .trim()
        .split(/\s+/)
        .map((sym) => MORSE_TABLE[sym] ?? "")
        .join(""),
    )
    .join(" ");
}

function tryBase64(s: string): string | undefined {
  try {
    const out = Buffer.from(s, "base64").toString("utf8");
    if (out.length === 0) return undefined;
    const printable = out.replace(/[^\x20-\x7e]/g, "").length / out.length;
    return printable > 0.9 ? out : undefined;
  } catch {
    return undefined;
  }
}

function tryHexText(s: string): string | undefined {
  const clean = s.startsWith("0x") ? s.slice(2) : s;
  try {
    const out = Buffer.from(clean, "hex").toString("utf8");
    const printable = out.replace(/[^\x20-\x7e]/g, "").length / Math.max(out.length, 1);
    return printable > 0.9 ? out : undefined;
  } catch {
    return undefined;
  }
}

/** Replaces common Latin-lookalike characters so homoglyph tricks do not dodge the regexes. */
export function normaliseHomoglyphs(text: string): string {
  const map: Record<string, string> = {
    а: "a",
    е: "e",
    о: "o",
    р: "p",
    с: "c",
    у: "y",
    х: "x",
    і: "i",
    ѕ: "s",
    ј: "j",
    һ: "h",
    ԁ: "d",
    ɡ: "g",
    ɑ: "a",
    ο: "o",
    α: "a",
    ı: "i",
    "０": "0",
  };
  return text.normalize("NFKC").replace(/[Ѐ-ӿͰ-Ͽı０-ｚ]/g, (c) => map[c] ?? c);
}

function matchPatterns(text: string): string[] {
  const hits: string[] = [];
  for (const p of INSTRUCTION_PATTERNS) if (p.re.test(text)) hits.push(p.id);
  return hits;
}

/**
 * Scans text and one level of decoded payloads (Base64, hex, Morse) for
 * instruction-like patterns. Decoded text is reported separately so the
 * caller can apply the decoded-content rule.
 */
export function scanForInjection(text: string, depth = 0): InjectionScan {
  const normalised = normaliseHomoglyphs(text);
  const matches = new Set(matchPatterns(normalised));
  const decodedLayers: string[] = [];
  if (depth < 1) {
    const candidates: { layer: string; text: string }[] = [];
    if (MORSE_RE.test(normalised)) {
      const line = normalised.match(MORSE_RE)?.[0] ?? "";
      candidates.push({ layer: "morse", text: decodeMorse(line) });
    }
    for (const m of normalised.match(BASE64_RE) ?? []) {
      const d = tryBase64(m);
      if (d) candidates.push({ layer: "base64", text: d });
    }
    for (const m of normalised.match(HEX_TEXT_RE) ?? []) {
      if (/^0x[0-9a-fA-F]{40}$/.test(m) || /^0x[0-9a-fA-F]{64}$/.test(m)) continue; // addresses and hashes
      const d = tryHexText(m);
      if (d) candidates.push({ layer: "hex", text: d });
    }
    for (const c of candidates) {
      decodedLayers.push(c.layer);
      const inner = scanForInjection(c.text, depth + 1);
      for (const hit of inner.matches) matches.add(`${c.layer}:${hit}`);
    }
  }
  return { suspected: matches.size > 0, matches: [...matches], decodedLayers };
}
