"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConfig } from "@/lib/live";
import { OwnerStatus } from "./OwnerStatus";

const items = [
  { href: "/", label: "Overview" },
  { href: "/agent", label: "Agent" },
  { href: "/approvals", label: "Approvals" },
  { href: "/mandate", label: "Mandate" },
  { href: "/audit", label: "Audit" },
  { href: "/security-lab", label: "Security Lab" },
  { href: "/identity", label: "Identity" },
];

export function Nav() {
  const path = usePathname();
  const cfg = useConfig();
  return (
    <aside
      className="w-60 shrink-0 border-r p-4 flex flex-col gap-4"
      style={{ borderColor: "var(--border)", background: "var(--panel-2)" }}
    >
      <div>
        <div className="text-lg font-semibold tracking-tight">Mandate</div>
        <div className="text-xs muted">An agent holds a mandate, not a key.</div>
      </div>
      <nav className="flex flex-col gap-1">
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className="rounded-md px-3 py-2 text-sm"
            style={{
              background: path === i.href ? "var(--panel)" : "transparent",
              color: path === i.href ? "var(--text)" : "var(--muted)",
              border: path === i.href ? "1px solid var(--border)" : "1px solid transparent",
            }}
          >
            {i.label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto text-xs muted space-y-2">
        <OwnerStatus />
        <div className="panel p-2">
          <div>{cfg ? cfg.chainName : "connecting..."}</div>
          <div className="mono truncate">vault {cfg?.vault ?? ""}</div>
          <div>planner: {cfg?.planner ?? ""}</div>
        </div>
        <div style={{ color: "var(--amber)" }}>Testnet only. Unaudited contract.</div>
      </div>
    </aside>
  );
}
