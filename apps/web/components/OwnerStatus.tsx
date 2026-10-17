"use client";
import { useEffect, useState } from "react";
import { api, ensureOwnerSession, getOwnerSession, clearOwnerSession } from "@/lib/api";
import { useConfig } from "@/lib/live";

export function OwnerStatus() {
  const cfg = useConfig();
  const [signer, setSigner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    if (!getOwnerSession()) return setSigner(null);
    const r = await api<{ signer: string | null }>("/auth/session");
    setSigner(r.signer);
  };
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, []);

  const login = async () => {
    if (!cfg) return;
    setBusy(true);
    setErr(null);
    try {
      await ensureOwnerSession(cfg);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel p-2 space-y-1">
      <div className="row justify-between">
        <span>Owner</span>
        {signer ? (
          <span className="badge badge-green">{signer}</span>
        ) : (
          <span className="badge badge-grey">not authenticated</span>
        )}
      </div>
      {signer ? (
        <button
          className="btn w-full"
          onClick={() => {
            clearOwnerSession();
            setSigner(null);
          }}
        >
          Sign out
        </button>
      ) : (
        <button className="btn btn-primary w-full" disabled={busy || !cfg} onClick={login}>
          {cfg?.passkeyRegistered
            ? "Authenticate with passkey"
            : cfg?.ownerApprovalAuth === "dev"
              ? "Dev owner session"
              : "Register owner passkey"}
        </button>
      )}
      {err ? <div style={{ color: "var(--red)" }}>{err}</div> : null}
    </div>
  );
}
