"use client";
import { useEffect, useRef, useState } from "react";
import { api, type IntentView } from "@/lib/api";
import { useConfig, useLive } from "@/lib/live";
import { Card, IntentSummary, LayerStrip, TraceList } from "@/components/ui";

interface ChatRow {
  id: number;
  ts: string;
  role: string;
  text: string;
  intent_ids: string;
}

const EXAMPLES = [
  "what is our portfolio?",
  "pay alice 0.0001 ETH",
  "wrap 0.0001 eth",
  "top up petty cash",
  "send 0.0012 ETH to 0xC0FFeE00000000000000000000000000000000Cc",
  "explain the last decision",
];

export default function AgentPage() {
  const cfg = useConfig();
  const [chat, setChat] = useState<ChatRow[]>([]);
  const [message, setMessage] = useState("");
  const [attachment, setAttachment] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<IntentView | null>(null);
  const [recent, setRecent] = useState<IntentView[]>([]);
  const follow = useRef(true); // follow the newest intent until the operator pins one
  const bottom = useRef<HTMLDivElement>(null);

  const load = () => {
    api<ChatRow[]>("/chat")
      .then(setChat)
      .catch(() => {});
    api<IntentView[]>("/intents?limit=12")
      .then((xs) => {
        setRecent(xs);
        setSelected((cur) => (cur ? (xs.find((x) => x.id === cur.id) ?? cur) : (xs[0] ?? null)));
      })
      .catch(() => {});
  };
  useEffect(() => {
    void load();
  }, []);
  useLive(["chat.message", "intent.updated", "trace.step"], (e) => {
    if (e.name === "intent.updated") {
      const v = e.data as IntentView;
      setRecent((xs) => [v, ...xs.filter((x) => x.id !== v.id)].slice(0, 12));
      setSelected((cur) => (follow.current || !cur || cur.id === v.id ? v : cur));
    } else if (e.name === "trace.step") {
      const { intentId } = e.data as { intentId: string };
      api<IntentView>(`/intents/${intentId}`)
        .then((v) => setSelected((cur) => (!cur || cur.id === v.id ? v : cur)))
        .catch(() => {});
    } else {
      api<ChatRow[]>("/chat")
        .then(setChat)
        .catch(() => {});
    }
  });
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  const send = async (text: string) => {
    if (!text.trim()) return;
    follow.current = true;
    setBusy(true);
    try {
      const attachments = attachment.trim()
        ? [{ kind: "invoice", origin: "pasted by operator", text: attachment }]
        : [];
      await api("/chat", { method: "POST", body: JSON.stringify({ message: text, attachments }) });
      setMessage("");
      setAttachment("");
      load();
    } catch (err) {
      setChat((c) => [
        ...c,
        {
          id: Date.now(),
          ts: new Date().toISOString(),
          role: "system",
          text: err instanceof Error ? err.message : String(err),
          intent_ids: "[]",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-5 gap-4 h-[calc(100vh-3rem)]">
      <Card title={`Agent (${cfg?.planner ?? "..."} planner)`} className="col-span-3 flex flex-col">
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {chat.length === 0 ? (
            <div className="muted text-sm">
              Say something to the agent. Only this channel is treated as owner instructions.
            </div>
          ) : null}
          {chat.map((m) => (
            <div
              key={m.id}
              className="rounded-md p-3 text-sm whitespace-pre-wrap"
              style={{
                background:
                  m.role === "owner"
                    ? "#0c2340"
                    : m.role === "system"
                      ? "#3b0d0d"
                      : "var(--panel-2)",
                marginLeft: m.role === "owner" ? "15%" : 0,
                marginRight: m.role === "owner" ? 0 : "15%",
              }}
            >
              <div className="text-[10px] muted mb-1">
                {m.role} at {new Date(m.ts).toLocaleTimeString()}
              </div>
              {m.text}
              {JSON.parse(m.intent_ids || "[]").map((id: string) => (
                <button
                  key={id}
                  className="btn mt-2 mr-2 text-xs"
                  onClick={() => {
                    follow.current = false;
                    void api<IntentView>(`/intents/${id}`).then(setSelected);
                  }}
                >
                  trace {id}
                </button>
              ))}
            </div>
          ))}
          <div ref={bottom} />
        </div>
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-1">
            {EXAMPLES.map((e) => (
              <button key={e} className="btn text-xs" onClick={() => setMessage(e)}>
                {e}
              </button>
            ))}
          </div>
          <textarea
            className="input text-xs"
            rows={2}
            placeholder="Optional untrusted attachment (an invoice, a quote, token metadata). It goes to quarantine, never to the planner."
            value={attachment}
            onChange={(e) => setAttachment(e.target.value)}
          />
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void send(message);
            }}
          >
            <input
              className="input"
              placeholder="Instruct the agent as the owner"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={busy}
            />
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "working" : "Send"}
            </button>
          </form>
        </div>
      </Card>

      <Card title="Decision trace" className="col-span-2 overflow-y-auto">
        {selected ? (
          <div className="space-y-3">
            <div className="text-xs muted">{selected.id}</div>
            <IntentSummary v={selected} />
            <LayerStrip steps={selected.trace?.steps ?? []} />
            {selected.verdict && selected.verdict.reasons.some((r) => r.severity !== "info") ? (
              <div className="text-xs space-y-1">
                {selected.verdict.reasons
                  .filter((r) => r.severity !== "info")
                  .map((r, i) => (
                    <div
                      key={i}
                      className="rounded p-2"
                      style={{
                        background: "var(--panel-2)",
                        borderLeft: `3px solid ${r.severity === "deny" ? "var(--red)" : r.severity === "escalate" ? "var(--amber)" : "var(--blue)"}`,
                      }}
                    >
                      <span className="font-semibold">{r.rule}</span> {r.message}{" "}
                      <span className="muted">{r.citations.map((c) => `[${c}]`).join(" ")}</span>
                    </div>
                  ))}
              </div>
            ) : null}
            <TraceList steps={selected.trace?.steps ?? []} />
          </div>
        ) : (
          <div className="muted text-sm">
            The trace of the latest intent appears here, layer by layer, as it happens.
          </div>
        )}
        {recent.length > 1 ? (
          <div className="mt-4 text-xs">
            <div className="muted mb-1">recent</div>
            {recent.map((v) => (
              <button
                key={v.id}
                className="btn text-xs mr-1 mb-1"
                onClick={() => {
                  follow.current = false;
                  setSelected(v);
                }}
              >
                {v.id} {v.state}
              </button>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
