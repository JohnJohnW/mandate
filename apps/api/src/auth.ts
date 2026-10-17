/**
 * Owner authentication for the local owner mode. The owner registers a passkey
 * once; every approval or mandate change then needs a fresh WebAuthn assertion
 * that yields a short-lived owner session. A "dev" mode exists for automated
 * tests only and is refused unless OWNER_APPROVAL_AUTH=dev is set explicitly.
 * [NIST-SP800-53 IA-2] [SimpleWebAuthn]
 */
import { randomBytes, randomUUID } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { Config } from "./config.js";
import type { Db } from "./db.js";

export class OwnerAuth {
  private sessions = new Map<string, { expires: number; signer: string }>();

  constructor(
    private readonly cfg: Config,
    private readonly db: Db,
  ) {}

  get hasPasskey(): boolean {
    return this.db.listPasskeys().length > 0;
  }

  /** Returns the signer label when the session header is valid, else undefined. */
  authenticate(header: string | undefined): string | undefined {
    if (!header) return undefined;
    if (this.cfg.ownerApprovalAuth === "dev" && header === "dev") return "owner (dev mode)";
    const s = this.sessions.get(header);
    if (!s) return undefined;
    if (s.expires < Date.now()) {
      this.sessions.delete(header);
      return undefined;
    }
    return s.signer;
  }

  private issueSession(signer: string): string {
    const token = randomBytes(24).toString("base64url");
    this.sessions.set(token, { expires: Date.now() + 10 * 60_000, signer });
    return token;
  }

  async registrationOptions() {
    if (this.hasPasskey)
      throw new Error("a passkey is already registered; remove the database file to reset");
    const options = await generateRegistrationOptions({
      rpName: "Mandate owner console",
      rpID: this.cfg.rpId,
      userName: "owner",
      userID: new TextEncoder().encode("mandate-owner"),
      attestationType: "none",
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    });
    const id = randomUUID();
    this.db.setChallenge(id, options.challenge, "register");
    return { challengeId: id, options };
  }

  async verifyRegistration(
    challengeId: string,
    response: RegistrationResponseJSON,
  ): Promise<{ ok: true; session: string }> {
    const ch = this.db.takeChallenge(challengeId);
    if (!ch || ch.purpose !== "register") throw new Error("challenge missing or expired");
    const v = await verifyRegistrationResponse({
      response,
      expectedChallenge: ch.challenge,
      expectedOrigin: this.cfg.rpOrigin,
      expectedRPID: this.cfg.rpId,
    });
    if (!v.verified || !v.registrationInfo) throw new Error("registration not verified");
    const cred = v.registrationInfo.credential;
    this.db.insertPasskey({
      id: cred.id,
      public_key: Buffer.from(cred.publicKey).toString("base64url"),
      counter: cred.counter,
      transports: JSON.stringify(cred.transports ?? []),
      created_at: new Date().toISOString(),
    });
    return { ok: true, session: this.issueSession("owner (passkey)") };
  }

  async assertionOptions() {
    const keys = this.db.listPasskeys();
    if (keys.length === 0) throw new Error("no passkey registered");
    const options = await generateAuthenticationOptions({
      rpID: this.cfg.rpId,
      userVerification: "preferred",
      allowCredentials: keys.map((k) => ({
        id: k.id,
        transports: JSON.parse(k.transports) as never,
      })),
    });
    const id = randomUUID();
    this.db.setChallenge(id, options.challenge, "assert");
    return { challengeId: id, options };
  }

  async verifyAssertion(
    challengeId: string,
    response: AuthenticationResponseJSON,
  ): Promise<{ ok: true; session: string }> {
    const ch = this.db.takeChallenge(challengeId);
    if (!ch || ch.purpose !== "assert") throw new Error("challenge missing or expired");
    const key = this.db.listPasskeys().find((k) => k.id === response.id);
    if (!key) throw new Error("unknown credential");
    const v = await verifyAuthenticationResponse({
      response,
      expectedChallenge: ch.challenge,
      expectedOrigin: this.cfg.rpOrigin,
      expectedRPID: this.cfg.rpId,
      credential: {
        id: key.id,
        publicKey: new Uint8Array(Buffer.from(key.public_key, "base64url")),
        counter: key.counter,
        transports: JSON.parse(key.transports) as never,
      },
    });
    if (!v.verified) throw new Error("assertion not verified");
    this.db.updatePasskeyCounter(key.id, v.authenticationInfo.newCounter);
    return { ok: true, session: this.issueSession("owner (passkey)") };
  }
}
