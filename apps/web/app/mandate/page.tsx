"use client";
import { useEffect, useState } from "react";
import { api, ensureOwnerSession, formatUnits, SELECTOR_NAMES, type Mandate } from "@/lib/api";
import { useConfig, useLive } from "@/lib/live";
import { Card } from "@/components/ui";

const ZERO = "0x0000000000000000000000000000000000000000";

export default function MandatePage() {
  const cfg = useConfig();
  const [m, setM] = useState<Mandate | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asset, setAsset] = useState({
    token: "ETH",
    autonomousPerTxCap: "",
    autonomousWindowCap: "",
    coSignPerTxCap: "",
    windowSeconds: 86400,
    enabled: true,
  });
  const [target, setTarget] = useState("");
  const [selector, setSelector] = useState({ target: "", selector: "0xd0e30db0" });
  const [expiryDays, setExpiryDays] = useState(7);
  const load = () =>
    api<Mandate>("/mandate")
      .then(setM)
      .catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  useLive(["mandate.updated"], load);

  const ownerPost = async (path: string, body: unknown, label: string) => {
    if (!cfg) return;
    setBusy(true);
    setMsg(null);
    try {
      await ensureOwnerSession(cfg);
      const r = await api<{ txHash: string; status: string; explorerUrl: string | null }>(
        path,
        { method: "POST", body: JSON.stringify(body) },
        true,
      );
      setMsg(`${label}: ${r.status}, tx ${r.txHash}${r.explorerUrl ? ` (${r.explorerUrl})` : ""}`);
      load();
    } catch (e) {
      setMsg(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const tokenMeta = (addr: string) =>
    cfg?.tokens.find((t) => t.address.toLowerCase() === addr.toLowerCase()) ??
    (addr === ZERO
      ? { symbol: "ETH", decimals: 18, address: ZERO }
      : { symbol: addr.slice(0, 8), decimals: 18, address: addr });

  const pickAsset = (addr: string) => {
    const a = m?.assets[addr];
    const t = tokenMeta(addr);
    if (!a) return;
    setAsset({
      token: t.symbol,
      autonomousPerTxCap: formatUnits(a.autonomousPerTxCap, t.decimals, 18),
      autonomousWindowCap: formatUnits(a.autonomousWindowCap, t.decimals, 18),
      coSignPerTxCap: formatUnits(a.coSignPerTxCap, t.decimals, 18),
      windowSeconds: Number(a.windowSeconds),
      enabled: a.enabled,
    });
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Mandate</h1>
        <p className="text-sm muted">
          Every change here is an owner transaction to the vault. The agent cannot call any of these
          functions.
        </p>
      </header>
      {msg ? <div className="panel p-3 text-xs mono break-all">{msg}</div> : null}

      <div className="grid grid-cols-3 gap-4">
        <Card title="Kill switch" className="col-span-1">
          <div className="space-y-2 text-sm">
            <div className="row gap-2">
              <span className={`badge ${m?.paused ? "badge-red" : "badge-green"}`}>
                {m?.paused ? "paused" : "running"}
              </span>
              <span className={`badge ${m?.active ? "badge-green" : "badge-red"}`}>
                {m?.active ? "agent active" : "agent revoked"}
              </span>
            </div>
            <p className="text-xs muted">
              Pause stops every agent for every asset. Revoke ends this agent's authority. Both are
              one transaction; any in-flight agent transaction reverts.
            </p>
            <div className="row">
              {m?.paused ? (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => ownerPost("/mandate/unpause", {}, "unpause")}
                >
                  Unpause
                </button>
              ) : (
                <button
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => ownerPost("/mandate/pause", {}, "pause")}
                >
                  Pause vault
                </button>
              )}
              <button
                className="btn btn-danger"
                disabled={busy || !m?.active}
                onClick={() => ownerPost("/mandate/revoke", {}, "revoke agent")}
              >
                Revoke agent
              </button>
            </div>
            <div className="row mt-2">
              <input
                className="input"
                type="number"
                min={1}
                max={365}
                value={expiryDays}
                onChange={(e) => setExpiryDays(Number(e.target.value))}
                style={{ width: 90 }}
              />
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  ownerPost("/mandate/agent", { expiryDays, active: true }, "set agent")
                }
              >
                Activate for N days
              </button>
            </div>
            {m ? (
              <div className="text-xs muted">
                expiry {new Date(Number(m.expiry) * 1000).toLocaleString()}, next nonce{" "}
                {m.nextNonce}
              </div>
            ) : null}
          </div>
        </Card>

        <Card title="Asset caps" className="col-span-2">
          {m ? (
            <table className="data mb-3">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Per tx (autonomous)</th>
                  <th>Window cap</th>
                  <th>Co-sign ceiling</th>
                  <th>Window</th>
                  <th>Spent</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(m.assets).map(([addr, a]) => {
                  const t = tokenMeta(addr);
                  return (
                    <tr key={addr}>
                      <td>
                        {t.symbol}{" "}
                        {a.enabled ? "" : <span className="badge badge-grey">disabled</span>}
                      </td>
                      <td className="mono">{formatUnits(a.autonomousPerTxCap, t.decimals)}</td>
                      <td className="mono">{formatUnits(a.autonomousWindowCap, t.decimals)}</td>
                      <td className="mono">{formatUnits(a.coSignPerTxCap, t.decimals)}</td>
                      <td>{Number(a.windowSeconds) / 3600} h</td>
                      <td className="mono">{formatUnits(a.spentInWindow, t.decimals)}</td>
                      <td>
                        <button className="btn text-xs" onClick={() => pickAsset(addr)}>
                          edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
          <div className="grid grid-cols-6 gap-2 text-xs items-end">
            <label>
              Token
              <select
                className="input"
                value={asset.token}
                onChange={(e) => setAsset({ ...asset, token: e.target.value })}
              >
                {["ETH", "USDC", "WETH"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Per tx
              <input
                className="input"
                value={asset.autonomousPerTxCap}
                onChange={(e) => setAsset({ ...asset, autonomousPerTxCap: e.target.value })}
              />
            </label>
            <label>
              Window cap
              <input
                className="input"
                value={asset.autonomousWindowCap}
                onChange={(e) => setAsset({ ...asset, autonomousWindowCap: e.target.value })}
              />
            </label>
            <label>
              Co-sign ceiling
              <input
                className="input"
                value={asset.coSignPerTxCap}
                onChange={(e) => setAsset({ ...asset, coSignPerTxCap: e.target.value })}
              />
            </label>
            <label>
              Window (s)
              <input
                className="input"
                type="number"
                value={asset.windowSeconds}
                onChange={(e) => setAsset({ ...asset, windowSeconds: Number(e.target.value) })}
              />
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={asset.enabled}
                onChange={(e) => setAsset({ ...asset, enabled: e.target.checked })}
              />{" "}
              enabled
            </label>
          </div>
          <button
            className="btn btn-primary mt-2"
            disabled={busy || !asset.autonomousPerTxCap}
            onClick={() => ownerPost("/mandate/asset", asset, "set asset mandate")}
          >
            Set asset mandate
          </button>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="Allowlisted targets">
          <ul className="text-xs mono space-y-1 mb-3">
            {m?.allowedTargets.length ? (
              m.allowedTargets.map((t) => (
                <li key={t} className="row justify-between">
                  <span>
                    {t}
                    {t.toLowerCase() === m.agent.toLowerCase() ? (
                      <span className="badge badge-grey ml-2">agent (petty cash)</span>
                    ) : null}
                  </span>
                  <button
                    className="btn text-xs"
                    disabled={busy}
                    onClick={() =>
                      ownerPost("/mandate/target", { target: t, allowed: false }, "disallow target")
                    }
                  >
                    remove
                  </button>
                </li>
              ))
            ) : (
              <li className="muted">none</li>
            )}
          </ul>
          <div className="row">
            <input
              className="input mono"
              placeholder="0x..."
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
            <button
              className="btn btn-primary"
              disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(target)}
              onClick={() =>
                ownerPost("/mandate/target", { target, allowed: true }, "allow target")
              }
            >
              Allow
            </button>
          </div>
        </Card>
        <Card title="Allowlisted contract calls">
          <ul className="text-xs mono space-y-1 mb-3">
            {m &&
              Object.entries(m.allowedSelectors).flatMap(([t, sels]) =>
                sels.map((s) => (
                  <li key={`${t}${s}`} className="row justify-between">
                    <span>
                      {t} : {s} <span className="muted">{SELECTOR_NAMES[s] ?? ""}</span>
                    </span>
                    <button
                      className="btn text-xs"
                      disabled={busy}
                      onClick={() =>
                        ownerPost(
                          "/mandate/selector",
                          { target: t, selector: s, allowed: false },
                          "disallow selector",
                        )
                      }
                    >
                      remove
                    </button>
                  </li>
                )),
              )}
            {m && Object.values(m.allowedSelectors).every((s) => s.length === 0) ? (
              <li className="muted">none</li>
            ) : null}
          </ul>
          <div className="grid grid-cols-3 gap-2">
            <input
              className="input mono col-span-2"
              placeholder="contract 0x..."
              value={selector.target}
              onChange={(e) => setSelector({ ...selector, target: e.target.value })}
            />
            <input
              className="input mono"
              placeholder="selector 0x........"
              value={selector.selector}
              onChange={(e) => setSelector({ ...selector, selector: e.target.value })}
            />
          </div>
          <button
            className="btn btn-primary mt-2"
            disabled={
              busy ||
              !/^0x[0-9a-fA-F]{40}$/.test(selector.target) ||
              !/^0x[0-9a-fA-F]{8}$/.test(selector.selector)
            }
            onClick={() =>
              ownerPost("/mandate/selector", { ...selector, allowed: true }, "allow selector")
            }
          >
            Allow call
          </button>
        </Card>
      </div>
    </div>
  );
}
