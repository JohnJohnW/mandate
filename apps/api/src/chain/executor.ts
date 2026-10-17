/**
 * The only place the agent key signs anything that moves value. It builds the
 * vault calls, sends them, waits for receipts and decodes reverts. The agent
 * key never signs a raw transfer; it only signs typed intents and the vault
 * transaction that carries them. [EIP-712]
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  encodeFunctionData,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { MANDATE_VAULT_ABI } from "@mandate/contracts";
import { approvalTypedData, intentTypedData, type Intent } from "@mandate/core";

export interface ExecutionResult {
  hash: Hex;
  status: "success" | "reverted";
  blockNumber: bigint;
  gasUsed: bigint;
  revertReason?: string;
  receipt: TransactionReceipt;
}

export class Executor {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly agentClient: WalletClient,
    private readonly vault: Address,
    private readonly chainId: number,
  ) {}

  get agentAddress(): Address {
    return this.agentClient.account!.address;
  }

  async signIntent(intent: Intent): Promise<Hex> {
    return this.agentClient.signTypedData({
      account: this.agentClient.account!,
      ...intentTypedData(intent, this.chainId, this.vault),
    });
  }

  /** Used in local owner mode only: the server-held owner key signs an approval. */
  static async signApproval(
    ownerClient: WalletClient,
    chainId: number,
    vault: Address,
    intentHash: Hex,
    deadline: bigint,
  ): Promise<Hex> {
    return ownerClient.signTypedData({
      account: ownerClient.account!,
      ...approvalTypedData({ intentHash, deadline }, chainId, vault),
    });
  }

  calldata(
    intent: Intent,
    data: Hex,
    agentSig: Hex,
    approval?: { deadline: bigint; ownerSig: Hex },
  ): Hex {
    return approval
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
  }

  /**
   * Sends the vault transaction. With `forceOnChain` the gas limit is fixed so a
   * transaction that will revert is still mined: that is how the Security Lab
   * produces on-chain revert evidence. Normal execution lets the node estimate
   * gas, which surfaces a revert before anything is broadcast.
   */
  async send(
    intent: Intent,
    data: Hex,
    agentSig: Hex,
    approval?: { deadline: bigint; ownerSig: Hex },
    forceOnChain = false,
  ): Promise<ExecutionResult> {
    const calldata = this.calldata(intent, data, agentSig, approval);
    const hash = await this.agentClient.sendTransaction({
      account: this.agentClient.account!,
      chain: this.agentClient.chain,
      to: this.vault,
      data: calldata,
      ...(forceOnChain ? { gas: 400_000n } : {}),
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    const result: ExecutionResult = {
      hash,
      status: receipt.status,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      receipt,
    };
    if (receipt.status === "reverted") {
      result.revertReason = await this.decodeRevert(calldata, receipt.blockNumber - 1n);
    }
    return result;
  }

  /** Replays a call against the pre-block state to recover the custom error. */
  async decodeRevert(calldata: Hex, blockNumber: bigint): Promise<string> {
    try {
      await this.publicClient.call({
        account: this.agentAddress,
        to: this.vault,
        data: calldata,
        blockNumber,
      });
      return "reverted (replay succeeded; state-dependent)";
    } catch (err) {
      return Executor.describeError(err);
    }
  }

  static describeError(err: unknown): string {
    if (err instanceof BaseError) {
      const revert = err.walk(
        (e) => e instanceof ContractFunctionRevertedError,
      ) as ContractFunctionRevertedError | null;
      if (revert?.data) {
        const args = revert.data.args?.length
          ? `(${revert.data.args.map(String).join(", ")})`
          : "()";
        return `${revert.data.errorName}${args}`;
      }
      // A plain call carries no ABI, so find the raw revert data anywhere in the cause chain
      // (viem keeps it on the RPC error) and decode it against the vault ABI.
      let data: Hex | undefined;
      let cur: unknown = err;
      while (cur && typeof cur === "object") {
        const d = (cur as { data?: unknown }).data;
        if (typeof d === "string" && d.startsWith("0x") && d.length >= 10) data = d as Hex;
        else if (d && typeof d === "object" && typeof (d as { data?: unknown }).data === "string")
          data = (d as { data: Hex }).data;
        cur = (cur as { cause?: unknown }).cause;
      }
      if (data && data !== "0x") {
        try {
          const d = decodeErrorResult({ abi: MANDATE_VAULT_ABI, data });
          return `${d.errorName}${d.args?.length ? `(${d.args.map(String).join(", ")})` : "()"}`;
        } catch {
          return `custom error ${data.slice(0, 10)}`;
        }
      }
      const m = err.message.match(/custom error (0x[0-9a-f]{8})/i);
      if (m) return `custom error ${m[1]}`;
      return err.shortMessage;
    }
    return err instanceof Error ? err.message : String(err);
  }
}
