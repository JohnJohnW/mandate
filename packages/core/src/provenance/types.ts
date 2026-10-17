/**
 * Provenance tags. Every value that can influence an intent carries one, so
 * the policy engine can tell owner-stated values from values that came out of
 * untrusted content. [OWASP-LLM01] [OWASP-ASI01] [Beurer-Kellner 2025]
 */
export type ProvenanceSource =
  | "owner" // typed by the authenticated owner in the owner channel
  | "chain" // read from the chain (mandate, balances, nonces)
  | "address_book" // resolved from the owner-maintained address book
  | "untrusted" // tool output, invoice, token metadata, web page, third-party message
  | "memory" // the agent's preference store (owner entries are re-tagged "owner")
  | "decoded"; // produced by decoding or translating content (Base64, hex, Morse, homoglyphs)

export interface Provenance {
  source: ProvenanceSource;
  /** Where the value came from, for the trace: tool name, URL, message id. */
  origin: string;
  /** Set by the quarantine reader when the surrounding content looked like instructions. */
  suspectedInjection?: boolean;
}

export interface Tagged<T> {
  value: T;
  provenance: Provenance;
}

export function tagged<T>(value: T, source: ProvenanceSource, origin: string): Tagged<T> {
  return { value, provenance: { source, origin } };
}

/** An untrusted input the runtime saw while planning this intent. */
export interface UntrustedInput {
  id: string;
  kind: "tool_output" | "invoice" | "token_metadata" | "memory" | "message" | "decoded" | "web";
  origin: string;
  text: string;
  suspectedInjection: boolean;
  matches: string[];
}
