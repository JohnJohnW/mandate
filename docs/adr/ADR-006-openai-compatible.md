# ADR-006 An OpenAI-compatible LLM abstraction

## Context
The build must not tie itself to one model vendor, and the brief asks that no vendor SDK name appear in the dependency tree.

## Decision
Use the Vercel AI SDK's OpenAI-compatible provider, configured entirely by environment variables (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`). Any OpenAI-compatible endpoint works: OpenAI, OpenRouter, DeepSeek, Qwen/DashScope, Ollama. A deterministic MockPlanner implements the same interface.

## Alternatives considered
- A specific vendor SDK: ties the build to one provider and puts a vendor name in the dependencies.

## Consequences
The model is a configuration choice, not a code change, and the demo runs offline from any LLM via the MockPlanner. The trade-off is that provider-specific features beyond the OpenAI-compatible surface are not available; we do not need them.
