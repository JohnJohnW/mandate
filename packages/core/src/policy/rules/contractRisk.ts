import { MAX_UINT256, selectorOf } from "../../intent/schema.js";
import { kindName } from "../../intent/kinds.js";
import type { Rule } from "../types.js";

/**
 * Contract risk: unlimited approvals, denied selectors, unverified or newly
 * deployed targets. [OWASP-SC-TOP10] [OWASP-LLM06]
 */
export const contractRiskRule: Rule = (intent, ctx) => {
  const citations = ["OWASP-SC-TOP10", "OWASP-LLM06"];
  const kind = kindName(intent.kind);
  const out = [] as ReturnType<Rule>;
  if (kind === "APPROVE_ERC20") {
    if (intent.amount === MAX_UINT256) {
      out.push({
        rule: "contract_risk",
        severity: "deny",
        message: "unlimited token approval is never permitted",
        citations,
      });
    } else if (intent.amount > 0n) {
      out.push({
        rule: "contract_risk",
        severity: "warn",
        message:
          "token approval grants a spender future pull rights; amount is bounded by the mandate cap",
        citations,
      });
    }
  }
  if (kind === "CALL") {
    const sel = ctx.calldata ? selectorOf(ctx.calldata) : undefined;
    if (sel && ctx.params.deniedSelectors.includes(sel)) {
      out.push({
        rule: "contract_risk",
        severity: "deny",
        message: `selector ${sel} is on the denylist (approval-for-all, upgrade, ownership or permit)`,
        citations,
      });
    }
    const t = ctx.targetInfo;
    if (t) {
      if (!t.isContract) {
        out.push({
          rule: "contract_risk",
          severity: "deny",
          message: "CALL target has no code",
          citations,
        });
      }
      if (t.sourceVerified === false) {
        out.push({
          rule: "contract_risk",
          severity: "warn",
          message: "target source is not verified on the explorer",
          citations,
        });
      } else if (t.sourceVerified === null) {
        out.push({
          rule: "contract_risk",
          severity: "warn",
          message: "explorer unavailable; could not check source verification",
          citations,
        });
      }
      if (
        t.deployedAtBlock !== undefined &&
        ctx.currentBlock - t.deployedAtBlock < ctx.params.newContractBlocks
      ) {
        out.push({
          rule: "contract_risk",
          severity: "warn",
          message: `target was deployed ${ctx.currentBlock - t.deployedAtBlock} blocks ago (newly deployed)`,
          citations,
        });
      }
    } else {
      out.push({
        rule: "contract_risk",
        severity: "warn",
        message: "no target information available for this CALL",
        citations,
      });
    }
  }
  if (out.length === 0)
    out.push({
      rule: "contract_risk",
      severity: "info",
      message: "no contract risk flags",
      citations,
    });
  return out;
};
