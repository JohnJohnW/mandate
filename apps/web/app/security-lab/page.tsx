import { Card } from "@/components/ui";

export default function SecurityLabPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Security Lab</h1>
        <p className="text-sm muted">
          Replays documented attack patterns against four defence configurations and reports
          measured results.
        </p>
      </header>
      <Card>
        <div className="text-sm muted">
          The attack catalog and runner are built in a later phase. Until then, the Agent page lets
          you try injection, poisoning and over-cap requests by hand and watch where each one stops.
        </div>
      </Card>
    </div>
  );
}
