/**
 * Deterministic planner for demos, tests and the attack harness. It is a
 * naive but honest planner: it proposes what the message asks for and leaves
 * the stopping to the policy engine and the vault, which is exactly the
 * property the Security Lab measures.
 */
import { isAddress } from "viem";
import type { Plan, PlanStep, Planner, PlannerInput } from "./types.js";

const AMOUNT = String.raw`(\d+(?:\.\d+)?|all|everything|max|unlimited)`;
const TOKEN = String.raw`(eth|ether|usdc|weth)`;
const TARGET = String.raw`(0x[0-9a-fA-F]{40}|[A-Za-z][A-Za-z0-9_-]{1,40})`;

export class MockPlanner implements Planner {
  readonly name = "mock" as const;
  private last: PlannerInput | undefined;

  lastInput(): PlannerInput | undefined {
    return this.last;
  }

  async plan(input: PlannerInput): Promise<Plan> {
    this.last = structuredClone(input);
    const msg = input.ownerMessage.trim();
    const m = msg.toLowerCase();
    const steps: PlanStep[] = [];
    const quarantined = input.quarantined;

    const refersToInvoice = /\b(invoice|quote|bill)\b/.test(m) && quarantined.length > 0;
    if (/\b(pay|settle)\b/.test(m) && refersToInvoice) {
      const q = quarantined[quarantined.length - 1]!;
      steps.push({
        id: "s1",
        tool: "propose_intent",
        args: {
          kind: "TRANSFER_ERC20",
          token: "USDC",
          to: { ref: q.id, field: "payTo" },
          amount: { ref: q.id, field: "amount" },
        },
        why: "pay the quarantined invoice using only its structured fields",
      });
      return {
        summary: "Pay the invoice from quarantined fields",
        steps,
        reply:
          "I will pay the invoice using the amount and payee parsed from it, subject to the mandate.",
      };
    }

    let r: RegExpMatchArray | null;
    if (
      (r = m.match(
        new RegExp(
          String.raw`\b(?:pay|send|transfer|move)\s+${AMOUNT}\s*${TOKEN}\s+(?:to\s+)?${TARGET}`,
        ),
      ))
    ) {
      steps.push(transfer(r[1]!, r[2]!, r[3]!, input));
    } else if (
      (r = m.match(
        new RegExp(String.raw`\b(?:pay|send|transfer)\s+${TARGET}\s+${AMOUNT}\s*${TOKEN}`),
      ))
    ) {
      steps.push(transfer(r[2]!, r[3]!, r[1]!, input));
    } else if ((r = m.match(new RegExp(String.raw`\bwrap\s+${AMOUNT}\s*(?:eth|ether)?`)))) {
      steps.push({
        id: "s1",
        tool: "propose_intent",
        args: { kind: "CALL", to: "WETH", amount: r[1]!, token: "ETH", data: "deposit()" },
        why: "move idle ETH into WETH via the allowlisted deposit() call",
      });
    } else if (
      (r = m.match(new RegExp(String.raw`\btop\s*up\b.*?petty\s*cash(?:.*?${AMOUNT}\s*usdc)?`)))
    ) {
      steps.push({
        id: "s1",
        tool: "propose_intent",
        args: { kind: "TOPUP_PETTY_CASH", token: "USDC", amount: r[1] ?? "0.5" },
        why: "replenish the agent's petty cash float",
      });
    } else if (
      (r = m.match(
        new RegExp(String.raw`\bapprove\s+${AMOUNT}\s*${TOKEN}\s+(?:to|for)\s+${TARGET}`),
      ))
    ) {
      steps.push({
        id: "s1",
        tool: "propose_intent",
        args: { kind: "APPROVE_ERC20", token: r[2]!.toUpperCase(), to: r[3]!, amount: r[1]! },
        why: "grant the requested spending allowance",
      });
    } else if (/\b(translate|decode|what does this say|morse|base64)\b/.test(m)) {
      steps.push({
        id: "s1",
        tool: "decode_text",
        args: { text: msg },
        why: "decode the content and show it as quoted data",
      });
    } else if ((r = m.match(/\b(?:screen|check|is)\s+(0x[0-9a-fA-F]{40})/))) {
      steps.push({
        id: "s1",
        tool: "screen_address",
        args: { address: r[1]! },
        why: "screen the address before any payment",
      });
    } else if (/\b(price|prices|quote|market)\b/.test(m)) {
      steps.push({
        id: "s1",
        tool: "get_prices",
        args: {},
        why: "fetch prices from the oracle agent (paid per request)",
      });
    } else if (/\b(balance|portfolio|holdings|what do we (have|hold)|how much)\b/.test(m)) {
      steps.push({ id: "s1", tool: "get_portfolio", args: {}, why: "read balances" });
    } else if (/\b(identity|who are you|agent card)\b/.test(m)) {
      steps.push({
        id: "s1",
        tool: "get_identity",
        args: {},
        why: "show the agent's on-chain identity",
      });
    } else if (/\b(why|explain|last decision)\b/.test(m)) {
      steps.push({
        id: "s1",
        tool: "explain_last_decision",
        args: {},
        why: "explain the most recent verdict",
      });
    } else if (/\b(mandate|limits|caps|what can you do)\b/.test(m)) {
      return {
        summary: "Describe the mandate",
        steps: [],
        reply: `Here is the mandate as the chain states it:\n${input.mandateSummary}`,
      };
    }

    if (steps.length === 0) {
      return {
        summary: "No action",
        steps: [],
        reply:
          "I can show the portfolio, pay a contact (for example: pay alice 0.0001 ETH), wrap ETH, top up petty cash, screen an address, or explain my last decision.",
      };
    }
    return { summary: steps.map((s) => s.why).join("; "), steps, reply: "" };
  }
}

function transfer(amount: string, token: string, target: string, input: PlannerInput): PlanStep {
  const tok = token.startsWith("eth") ? "ETH" : token.toUpperCase();
  const kind = tok === "ETH" ? "TRANSFER_NATIVE" : "TRANSFER_ERC20";
  const to = isAddress(target, { strict: false })
    ? target
    : (input.contacts.find((c) => c.name.toLowerCase() === target.toLowerCase())?.name ?? target);
  return {
    id: "s1",
    tool: "propose_intent",
    args: { kind, token: tok, to, amount },
    why: `transfer ${amount} ${tok} to ${to}`,
  };
}
