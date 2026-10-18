/**
 * The prompt-level denylist that stands in for configuration B. It is a short
 * list of obvious injection phrases a naive guard might add to a system prompt.
 * It exists only inside the harness, to show how little a prompt filter buys
 * you. The real product never relies on it. [OWASP-LLM01]
 */
const DENYLIST: RegExp[] = [
  /ignore (all |your |the )?(previous |prior |above )?(instructions|mandate|rules)/i,
  /send (all|everything)/i,
  /\bdrain\b/i,
  /system prompt/i,
  /executive tier/i,
  /unlimited permissions/i,
  /approve unlimited/i,
];

/** Returns the phrase that tripped the guard, or undefined. */
export function promptGuardTrips(text: string): string | undefined {
  for (const re of DENYLIST) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return undefined;
}
