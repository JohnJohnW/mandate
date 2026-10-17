/**
 * Machine-to-machine payments. The agent pays x402 invoices from its petty
 * cash float (USDC held by the agent EOA), never from the vault. Every
 * payment passes a small petty cash policy first: the payee must be the
 * counterparty's registered wallet (Know Your Agent), the amount must be under
 * the per-payment cap, the day's total under the daily cap, and the payee must
 * clear sanctions screening. A low float triggers a Tier 1 top-up through the
 * normal intent pipeline. [X402-V2] [EIP-3009] [ERC-8004] [FATF-R15]
 */
import { createPublicClient, erc20Abi, formatUnits, http, parseUnits, type Address } from "viem";
import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import type { Reason } from "@mandate/core";
import type { Clients } from "./chain/clients.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { EventBus } from "./events.js";
import type { IntentService } from "./pipeline/service.js";
import type { ScreeningProvider } from "./screening.js";
import type { Identity } from "./identity.js";

export interface PettyCashLimits {
  maxPaymentUsdc: bigint; // base units
  minFloatUsdc: bigint;
  topupUsdc: bigint;
  dailyCapUsdc: bigint;
}

export interface PaymentRecord {
  at: string;
  resource: string;
  payTo: string;
  amount: string;
  amountFormatted: string;
  network: string;
  txHash: string | null;
  payer: string | null;
  status: "paid" | "blocked" | "failed";
  reasons: Reason[];
}

export function pettyCashLimits(): PettyCashLimits {
  const e = process.env;
  return {
    maxPaymentUsdc: parseUnits(e.X402_MAX_PAYMENT_USDC ?? "0.01", 6),
    minFloatUsdc: parseUnits(e.PETTY_CASH_MIN_USDC ?? "0.2", 6),
    topupUsdc: parseUnits(e.PETTY_CASH_TOPUP_USDC ?? "0.5", 6),
    dailyCapUsdc: parseUnits(e.X402_DAILY_CAP_USDC ?? "1", 6),
  };
}

export class X402Payer {
  private readonly fetchWithPayment: typeof fetch;
  private history: PaymentRecord[] = [];

  constructor(
    private readonly cfg: Config,
    private readonly clients: Clients,
    private readonly db: Db,
    private readonly bus: EventBus,
    private readonly intents: IntentService,
    private readonly screening: ScreeningProvider,
    private readonly identity: Identity,
    readonly limits: PettyCashLimits = pettyCashLimits(),
  ) {
    const publicClient = createPublicClient({ chain: clients.chain, transport: http(cfg.rpcUrl) });
    const signer = toClientEvmSigner(
      {
        address: clients.agent.address,
        signTypedData: (m) => clients.agent.signTypedData(m as never),
      },
      publicClient as never,
    );
    // The client library's own spend controls are a second layer under our petty cash policy:
    // only our USDC on our chain, never more than the per-payment cap.
    this.fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [{ network: "eip155:*", client: new ExactEvmScheme(signer) }],
      spendControls: {
        allowedAssets: [
          {
            network: `eip155:${cfg.chainId}`,
            asset: cfg.usdcAddress,
            maxAmountPerPayment: limits.maxPaymentUsdc.toString(),
          },
        ],
        maxAmountPerPayment: formatUnits(limits.maxPaymentUsdc, 6),
      },
    }) as typeof fetch;
  }

  list(): PaymentRecord[] {
    return [...this.history];
  }

  async floatBalance(): Promise<bigint> {
    return (await this.clients.publicClient.readContract({
      address: this.cfg.usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [this.clients.agent.address],
    })) as bigint;
  }

  private spentToday(): bigint {
    const since = Date.now() - 86_400_000;
    return this.history
      .filter((p) => p.status === "paid" && Date.parse(p.at) > since)
      .reduce((n, p) => n + BigInt(p.amount), 0n);
  }

  /** Reads the 402 challenge without paying, so policy can see the exact terms first. */
  async quote(
    url: string,
  ): Promise<
    | { payTo: Address; amount: bigint; asset: string; network: string; description: string }
    | undefined
  > {
    const res = await fetch(url);
    if (res.status !== 402) return undefined;
    const header = res.headers.get("PAYMENT-REQUIRED");
    if (!header) return undefined;
    const body = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
      accepts?: {
        payTo: string;
        amount: string;
        asset: string;
        network: string;
        description?: string;
      }[];
    };
    const a = body.accepts?.[0];
    if (!a) return undefined;
    return {
      payTo: a.payTo as Address,
      amount: BigInt(a.amount),
      asset: a.asset,
      network: a.network,
      description: a.description ?? "",
    };
  }

  /** Petty cash policy: deterministic, cited, fail closed. */
  async evaluate(
    q: { payTo: Address; amount: bigint; asset: string; network: string },
    resource: string,
  ): Promise<{ allow: boolean; reasons: Reason[] }> {
    const reasons: Reason[] = [];
    const deny = (rule: string, message: string, citations: string[]) =>
      reasons.push({ rule, severity: "deny", message, citations });
    if (q.network !== `eip155:${this.cfg.chainId}`)
      deny(
        "petty_cash_network",
        `invoice is for ${q.network}, we are on eip155:${this.cfg.chainId}`,
        ["CAIP-2"],
      );
    if (q.asset.toLowerCase() !== this.cfg.usdcAddress.toLowerCase())
      deny("petty_cash_asset", `invoice asks for ${q.asset}, petty cash is USDC only`, ["X402-V2"]);
    if (q.amount > this.limits.maxPaymentUsdc)
      deny(
        "petty_cash_cap",
        `${formatUnits(q.amount, 6)} USDC exceeds the per-payment cap of ${formatUnits(this.limits.maxPaymentUsdc, 6)} USDC`,
        ["NIST-SP800-53 AC-6"],
      );
    if (this.spentToday() + q.amount > this.limits.dailyCapUsdc)
      deny(
        "petty_cash_daily",
        `today's x402 spend would exceed ${formatUnits(this.limits.dailyCapUsdc, 6)} USDC`,
        ["NIST-SP800-53 AC-6"],
      );
    const block = await this.clients.publicClient.getBlock();
    const s = this.screening.screen([q.payTo], block.timestamp);
    if (!s.loaded || s.hits.length)
      deny(
        "screening",
        s.loaded ? "payee matches the sanctions list" : "sanctions list not loaded (fail closed)",
        ["OFAC-SDN", "FATF-R15"],
      );
    const kya = await this.identity.knowYourAgent(resource, q.payTo);
    if (!kya.ok) deny("know_your_agent", kya.detail, ["ERC-8004", "NIST-AGENT-INIT"]);
    else
      reasons.push({
        rule: "know_your_agent",
        severity: "info",
        message: kya.detail,
        citations: ["ERC-8004"],
      });
    return { allow: reasons.every((r) => r.severity !== "deny"), reasons };
  }

  /** Tops the float up from the vault through the normal Tier 1 pipeline when it is low. */
  async ensureFloat(): Promise<{ topped: boolean; detail: string }> {
    const bal = await this.floatBalance();
    if (bal >= this.limits.minFloatUsdc)
      return { topped: false, detail: `float ${formatUnits(bal, 6)} USDC` };
    const view = await this.intents.propose({
      draft: {
        kind: "TOPUP_PETTY_CASH",
        target: this.clients.agent.address,
        token: this.cfg.usdcAddress,
        amount: this.limits.topupUsdc,
        data: "0x",
        rationale: `Petty cash float is ${formatUnits(bal, 6)} USDC, below the ${formatUnits(this.limits.minFloatUsdc, 6)} USDC floor; replenish by ${formatUnits(this.limits.topupUsdc, 6)} USDC`,
      },
      provenance: {
        target: { source: "chain", origin: "agent address" },
        amount: { source: "owner", origin: "PETTY_CASH_TOPUP_USDC setting" },
      },
      untrustedInputs: [],
      source: "petty-cash",
    });
    return {
      topped: view.state === "Executed",
      detail: `float ${formatUnits(bal, 6)} USDC was below the floor; top-up intent ${view.id} ended ${view.state}${view.revertReason ? ` (${view.revertReason})` : ""}`,
    };
  }

  /** Full flow: quote, policy, float, pay, record. Returns the paid body and the record. */
  async pay(url: string): Promise<{ record: PaymentRecord; body?: unknown }> {
    const q = await this.quote(url);
    const base: Omit<PaymentRecord, "status" | "reasons"> = {
      at: new Date().toISOString(),
      resource: url,
      payTo: q?.payTo ?? "",
      amount: q?.amount.toString() ?? "0",
      amountFormatted: q ? `${formatUnits(q.amount, 6)} USDC` : "",
      network: q?.network ?? "",
      txHash: null,
      payer: null,
    };
    if (!q) {
      const rec: PaymentRecord = {
        ...base,
        status: "failed",
        reasons: [
          {
            rule: "x402",
            severity: "deny",
            message: "resource did not return an x402 challenge",
            citations: ["X402-V2"],
          },
        ],
      };
      this.remember(rec);
      return { record: rec };
    }
    const verdict = await this.evaluate(q, url);
    if (!verdict.allow) {
      const rec: PaymentRecord = { ...base, status: "blocked", reasons: verdict.reasons };
      this.remember(rec);
      return { record: rec };
    }
    const float = await this.ensureFloat();
    const bal = await this.floatBalance();
    if (bal < q.amount) {
      const rec: PaymentRecord = {
        ...base,
        status: "blocked",
        reasons: [
          ...verdict.reasons,
          {
            rule: "petty_cash_float",
            severity: "deny",
            message: `float ${formatUnits(bal, 6)} USDC cannot cover ${formatUnits(q.amount, 6)} USDC; ${float.detail}`,
            citations: ["NIST-SP800-53 AC-6"],
          },
        ],
      };
      this.remember(rec);
      return { record: rec };
    }
    try {
      const res = await this.fetchWithPayment(url);
      const header = res.headers.get("PAYMENT-RESPONSE");
      const settled = header
        ? (decodePaymentResponseHeader(header) as {
            success?: boolean;
            transaction?: string;
            payer?: string;
          })
        : undefined;
      const body: unknown = await res.json().catch(() => undefined);
      if (!res.ok) {
        const rec: PaymentRecord = {
          ...base,
          status: "failed",
          reasons: [
            ...verdict.reasons,
            {
              rule: "x402",
              severity: "deny",
              message: `payment rejected: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`,
              citations: ["X402-V2"],
            },
          ],
        };
        this.remember(rec);
        return { record: rec, body };
      }
      const rec: PaymentRecord = {
        ...base,
        txHash: settled?.transaction ?? null,
        payer: settled?.payer ?? null,
        status: "paid",
        reasons: [
          ...verdict.reasons,
          {
            rule: "x402",
            severity: "info",
            message: `settled${settled?.transaction ? ` in ${settled.transaction}` : ""}${float.topped ? "; float topped up first" : ""}`,
            citations: ["X402-V2", "EIP-3009"],
          },
        ],
      };
      this.db.insertSpend({
        ts: rec.at,
        token: this.cfg.usdcAddress,
        amount: rec.amount,
        target: rec.payTo,
        tier: 1,
        intent_id: `x402:${rec.txHash ?? "unsettled"}`,
      });
      this.remember(rec);
      return { record: rec, body };
    } catch (err) {
      const rec: PaymentRecord = {
        ...base,
        status: "failed",
        reasons: [
          ...verdict.reasons,
          {
            rule: "x402",
            severity: "deny",
            message: err instanceof Error ? err.message : String(err),
            citations: ["X402-V2"],
          },
        ],
      };
      this.remember(rec);
      return { record: rec };
    }
  }

  private remember(rec: PaymentRecord): void {
    this.history.unshift(rec);
    if (this.history.length > 200) this.history.pop();
    this.intents.audit.append({
      actor: "agent",
      event: rec.status === "paid" ? "x402.paid" : "x402.blocked",
      payload: rec,
    });
    this.bus.emit("system", { kind: "x402", record: rec });
  }
}
