/**
 * In-process x402 facilitator for local chains. The public facilitator at
 * x402.org only settles on public testnets, so on Anvil the oracle verifies
 * and settles EIP-3009 authorizations itself with the same scheme code the
 * public facilitator runs. [X402-V2] [EIP-3009]
 */
import { createPublicClient, createWalletClient, http, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Facilitator } from "@x402/core/facilitator";
import type { FacilitatorClient } from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";

export function createLocalFacilitatorClient(
  chain: Chain,
  rpcUrl: string,
  privateKey: Hex,
  network: string,
): FacilitatorClient {
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ chain, transport: http(rpcUrl), account });
  const signer = toFacilitatorEvmSigner({
    address: account.address,
    readContract: (args) => publicClient.readContract(args as never),
    verifyTypedData: (args) => publicClient.verifyTypedData(args as never),
    writeContract: (args) =>
      walletClient.writeContract({ ...(args as object), account, chain } as never),
    sendTransaction: (args) =>
      walletClient.sendTransaction({ ...(args as object), account, chain } as never),
    waitForTransactionReceipt: (args) => publicClient.waitForTransactionReceipt(args as never),
    getCode: (args) => publicClient.getCode(args as never),
  });
  const facilitator = registerExactEvmScheme(new x402Facilitator(), {
    signer,
    networks: network as never,
  });
  return {
    verify: (p: PaymentPayload, r: PaymentRequirements): Promise<VerifyResponse> =>
      facilitator.verify(p, r),
    settle: (p: PaymentPayload, r: PaymentRequirements): Promise<SettleResponse> =>
      facilitator.settle(p, r),
    getSupported: async (): Promise<SupportedResponse> =>
      facilitator.getSupported() as SupportedResponse,
  };
}
