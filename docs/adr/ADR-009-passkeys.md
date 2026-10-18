# ADR-009 Passkeys for owner approval in local mode, not OTP

## Context
In local owner mode the server holds the owner key. Every sensitive action (a Tier 2 co-signature, a mandate change, the kill switch) should require a fresh human authentication so a compromised session cannot act alone.

## Decision
Gate sensitive actions with a WebAuthn passkey assertion. The owner registers a passkey once; each sensitive action needs a fresh assertion that yields a short-lived owner session.

## Alternatives considered
- One-time passwords (OTP) over email or SMS: phishable, and SMS is weak. OTP adds a delivery dependency.
- No gate: a compromised session could approve its own escalations.

## Consequences
Owner actions need a phishing-resistant, device-bound authentication, with no shared secret to steal. The trade-off is the WebAuthn setup and that local mode still holds the owner key behind the gate; MetaMask mode removes the server-held key entirely and is the recommended production path. A `dev` auth mode exists for automated tests only and is refused unless explicitly enabled.
