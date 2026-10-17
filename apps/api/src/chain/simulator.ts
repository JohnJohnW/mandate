/**
 * Pre-flight simulation. Tries eth_simulateV1 with transfer tracing so the
 * observed asset deltas can be compared with what the intent claims; falls
 * back to eth_call, which only tells us whether the call reverts. Either way
 * an unavailable RPC fails closed. [OWASP-LLM05]
 */
import {
  decodeErrorResult,
  encodeFunctionData,
  erc20Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { MANDATE_VAULT_ABI } from "@mandate/contracts";
import { Executor } from "./executor.js";
import {
  ZERO_ADDRESS,
  kindName,
  selectorOf,
  type Intent,
  type SimulationResult,
} from "@mandate/core";

const ETH_TRACE_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const DEPOSIT_SELECTOR = "0xd0e30db0";

interface SimulateCallResult {
  status: Hex;
  returnData: Hex;
  gasUsed: Hex;
  logs: { address: Address; topics: Hex[]; data: Hex }[];
  error?: { message?: string; data?: Hex };
}

export class Simulator {
  private simulateSupported: boolean | undefined;

  constructor(
    private readonly client: PublicClient,
    private readonly vault: Address,
    private readonly agent: Address,
    private readonly weth: Address,
  ) {}

  /** Expected deltas from the intent alone. Keys: `${token}:${holder}` in lowercase, token zero address for ETH. */
  expectedDeltas(intent: Intent, data: Hex): Record<string, bigint> {
    const kind = kindName(intent.kind);
    const v = this.vault.toLowerCase();
    const t = intent.target.toLowerCase();
    const token = intent.token.toLowerCase();
    const out: Record<string, bigint> = {};
    switch (kind) {
      case "TRANSFER_NATIVE":
        out[`${ZERO_ADDRESS}:${v}`] = -intent.amount;
        out[`${ZERO_ADDRESS}:${t}`] = intent.amount;
        break;
      case "TRANSFER_ERC20":
      case "TOPUP_PETTY_CASH":
        out[`${token}:${v}`] = -intent.amount;
        out[`${token}:${t}`] = intent.amount;
        break;
      case "APPROVE_ERC20":
        break; // no balance changes; the allowance is checked separately
      case "CALL":
        if (intent.amount > 0n) out[`${ZERO_ADDRESS}:${v}`] = -intent.amount;
        if (t === this.weth.toLowerCase() && selectorOf(data) === DEPOSIT_SELECTOR)
          out[`${this.weth.toLowerCase()}:${v}`] = intent.amount;
        break;
      default:
        break;
    }
    return out;
  }

  async simulate(
    intent: Intent,
    data: Hex,
    agentSig: Hex,
    approval?: { deadline: bigint; ownerSig: Hex },
  ): Promise<SimulationResult> {
    const calldata = approval
      ? encodeFunctionData({
          abi: MANDATE_VAULT_ABI,
          functionName: "executeWithApproval",
          args: [intent, data, agentSig, approval.deadline, approval.ownerSig],
        })
      : encodeFunctionData({
          abi: MANDATE_VAULT_ABI,
          functionName: "execute",
          args: [intent, data, agentSig],
        });
    const expected = this.expectedDeltas(intent, data);
    try {
      if (this.simulateSupported !== false) {
        const r = await this.viaSimulateV1(intent, calldata, expected);
        if (r) return r;
      }
      return await this.viaEthCall(calldata, expected);
    } catch (err) {
      return {
        ok: false,
        method: "none",
        expectedDeltas: expected,
        observedDeltas: {},
        deviation: false,
        revertReason: `simulation unavailable: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async viaSimulateV1(
    intent: Intent,
    calldata: Hex,
    expected: Record<string, bigint>,
  ): Promise<SimulationResult | undefined> {
    const tokenHolders = Object.keys(expected)
      .map((k) => k.split(":") as [string, string])
      .filter(([token]) => token !== ZERO_ADDRESS);
    const balanceCalls = tokenHolders.map(([token, holder]) => ({
      to: token as Address,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [holder as Address],
      }),
    }));
    let res: { calls: SimulateCallResult[] }[];
    try {
      res = (await this.client.request({
        // eth_simulateV1 is not in viem's typed RPC schema for every chain, so the request is cast.
        method: "eth_simulateV1" as never,
        params: [
          {
            blockStateCalls: [
              { calls: [{ from: this.agent, to: this.vault, data: calldata }, ...balanceCalls] },
            ],
            traceTransfers: true,
            validation: false,
          },
          "latest",
        ] as never,
      })) as { calls: SimulateCallResult[] }[];
      this.simulateSupported = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/method not found|not supported|does not exist|unsupported|-32601|-32004/i.test(msg)) {
        this.simulateSupported = false;
        return undefined;
      }
      throw err;
    }
    const block = res[0];
    const main = block?.calls[0];
    if (!main) return undefined;
    if (main.status !== "0x1") {
      return {
        ok: false,
        method: "eth_simulateV1",
        expectedDeltas: expected,
        observedDeltas: {},
        deviation: false,
        revertReason: this.decodeRevertData(main.error?.data ?? main.returnData),
      };
    }
    const observed: Record<string, bigint> = {};
    for (const log of main.logs) {
      if (log.address.toLowerCase() !== ETH_TRACE_ADDRESS || log.topics[0] !== TRANSFER_TOPIC)
        continue;
      const from = `0x${(log.topics[1] ?? "").slice(26)}`.toLowerCase();
      const to = `0x${(log.topics[2] ?? "").slice(26)}`.toLowerCase();
      const value = BigInt(log.data);
      observed[`${ZERO_ADDRESS}:${from}`] = (observed[`${ZERO_ADDRESS}:${from}`] ?? 0n) - value;
      observed[`${ZERO_ADDRESS}:${to}`] = (observed[`${ZERO_ADDRESS}:${to}`] ?? 0n) + value;
    }
    // ERC-20 deltas: post-state balance (from the batched call) minus pre-state balance (latest)
    for (let i = 0; i < tokenHolders.length; i++) {
      const [token, holder] = tokenHolders[i]!;
      const after = BigInt(block!.calls[i + 1]?.returnData ?? "0x0");
      const before = (await this.client.readContract({
        address: token as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [holder as Address],
      })) as bigint;
      observed[`${token}:${holder}`] = after - before;
    }
    // Only compare the keys the intent makes a claim about, plus any unexpected ETH outflow from the vault.
    let deviation = false;
    for (const [k, v] of Object.entries(expected)) if ((observed[k] ?? 0n) !== v) deviation = true;
    const vaultEth = observed[`${ZERO_ADDRESS}:${this.vault.toLowerCase()}`] ?? 0n;
    if (!(`${ZERO_ADDRESS}:${this.vault.toLowerCase()}` in expected) && vaultEth !== 0n)
      deviation = true;
    const result: SimulationResult = {
      ok: true,
      method: "eth_simulateV1",
      expectedDeltas: expected,
      observedDeltas: observed,
      deviation,
    };
    if (kindName(intent.kind) === "APPROVE_ERC20") {
      // allowance after the call is not readable from the trace without another call; record intent only
      result.observedDeltas = {};
    }
    return result;
  }

  private async viaEthCall(
    calldata: Hex,
    expected: Record<string, bigint>,
  ): Promise<SimulationResult> {
    try {
      await this.client.call({ account: this.agent, to: this.vault, data: calldata });
      return {
        ok: true,
        method: "eth_call",
        expectedDeltas: expected,
        observedDeltas: {},
        deviation: false,
      };
    } catch (err) {
      return {
        ok: false,
        method: "eth_call",
        expectedDeltas: expected,
        observedDeltas: {},
        deviation: false,
        revertReason: Executor.describeError(err),
      };
    }
  }

  private decodeRevertData(data: Hex | undefined): string {
    if (!data || data === "0x") return "reverted without data";
    try {
      const d = decodeErrorResult({ abi: MANDATE_VAULT_ABI, data });
      return `${d.errorName}${d.args?.length ? `(${d.args.map(String).join(", ")})` : "()"}`;
    } catch {
      return `reverted with data ${data.slice(0, 10)}`;
    }
  }
}
