# ADR-005 Plan-then-execute, not ReAct

## Context
An agent can interleave thinking and acting (ReAct), where tool outputs feed back into the model's next step, or it can plan first and then execute a fixed plan without feeding tool outputs back to the planner.

## Decision
Use plan-then-execute. The planner produces a fixed, typed plan from trusted inputs only. The executor runs the steps. Tool outputs never return to the planner; untrusted content reaches the plan only as quarantined fields referenced by id.

## Alternatives considered
- ReAct: more flexible, but it feeds tool output (which can contain injected instructions) straight back into the model, which is the exact mechanism behind the documented agent-wallet drains. [Beurer-Kellner 2025] [INC-GROK-BANKR]

## Consequences
The planner cannot be hijacked by content it reads mid-task, because it does not read content mid-task. We give up some flexibility: multi-step reasoning that genuinely needs a tool result to decide the next step must be expressed as separate owner turns or as deterministic parsing in the quarantine reader. Our pipeline tests assert the planner never saw the untrusted text.
