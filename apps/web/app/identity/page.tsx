import { Card } from "@/components/ui";

export default function IdentityPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Identity</h1>
        <p className="text-sm muted">
          ERC-8004 agent cards for our agent and the counterparties it pays.
        </p>
      </header>
      <Card>
        <div className="text-sm muted">
          Registration in the ERC-8004 Identity Registry and the Know Your Agent check are built in
          the identity phase. The agent and vault addresses are on the Overview page.
        </div>
      </Card>
    </div>
  );
}
