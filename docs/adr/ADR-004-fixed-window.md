# ADR-004 A fixed spending window, not a sliding window

## Context
The per-window cap needs a notion of "window". A sliding window (spend in the last 24 hours) is more precise; a fixed window (spend since the window started, reset when it elapses) is simpler and cheaper on-chain.

## Decision
Use a fixed window: when `block.timestamp >= windowStart + windowSeconds`, the window restarts at the current time with zero spent.

## Alternatives considered
- A sliding window: requires storing timestamped spend entries and summing them on every transaction, which is unbounded storage and gas.

## Consequences
The accounting is a few words of storage and a single comparison, cheap and easy to reason about. The off-chain policy engine mirrors it exactly, pinned by a shared fixture tested on both sides. The trade-off is a known edge of fixed windows: up to twice the cap can move across a window boundary (the end of one window and the start of the next). For a blast-radius bound this is acceptable and documented; a sliding window is a possible future refinement.
