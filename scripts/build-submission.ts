/**
 * Builds the submission package: renders the mermaid diagrams in the docs to SVG,
 * assembles the required PDFs, exports the deck to PDF and PPTX, and zips it all
 * with a manifest. Uses tools verified to work on this machine: Marp with the
 * system Chrome, pandoc with weasyprint, and mermaid-cli with Chrome.
 *
 * Usage: pnpm submission:build
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";

const ROOT = new URL("../", import.meta.url).pathname;
const SUB = `${ROOT}submission`;
const SVG = `${SUB}/svg`;
const BIN = `${ROOT}node_modules/.bin`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const env = { ...process.env, CHROME_PATH: CHROME, PUPPETEER_EXECUTABLE_PATH: CHROME };

mkdirSync(SVG, { recursive: true });

function commit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim();
  } catch {
    return "unknown";
  }
}
const COMMIT = commit();
const TEAM = "Team Mandate";
const REPO = "https://github.com/JohnJohnW/mandate";
const DATE = new Date().toISOString().slice(0, 10);

/** Renders every ```mermaid block in a markdown string to an SVG and replaces it with an image. */
function renderMermaid(md: string): string {
  const puppeteer = `${SVG}/puppeteer.json`;
  writeFileSync(puppeteer, JSON.stringify({ executablePath: CHROME, args: ["--no-sandbox"] }));
  return md.replace(/```mermaid\n([\s\S]*?)```/g, (_m, code: string) => {
    const hash = createHash("sha1").update(code).digest("hex").slice(0, 12);
    const mmd = `${SVG}/${hash}.mmd`;
    const png = `${SVG}/${hash}.png`;
    if (!existsSync(png)) {
      writeFileSync(mmd, code);
      try {
        execFileSync(`${BIN}/mmdc`, ["-i", mmd, "-o", png, "-p", puppeteer, "-b", "white", "-t", "neutral", "-s", "2"], { env, stdio: "pipe" });
      } catch (err) {
        console.warn(`  mermaid render failed for ${hash}, keeping the source: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
        return "```\n" + code + "```";
      }
    }
    return `\n![diagram](svg/${hash}.png)\n`;
  });
}

/** Assembles several markdown docs into one PDF with a cover page, via pandoc + weasyprint. */
function buildPdf(outName: string, title: string, sources: string[]): void {
  const cover = `---
title: "${title}"
author: "${TEAM}"
date: "${DATE}"
---

<div style="text-align:center; margin-top: 30%;">

# ${title}

${TEAM}

${REPO}

commit ${COMMIT} · ${DATE}

Testnet research prototype. The vault contract is unaudited.

</div>

<div style="page-break-after: always;"></div>

`;
  let body = cover;
  for (const src of sources) {
    const raw = readFileSync(`${ROOT}${src}`, "utf8");
    body += renderMermaid(raw) + "\n\n<div style=\"page-break-after: always;\"></div>\n\n";
  }
  const tmp = `${SUB}/.${outName}.md`;
  writeFileSync(tmp, body);
  const css = `${SUB}/.pdf.css`;
  writeFileSync(css, `
    @page { size: A4; margin: 2cm; @bottom-center { content: "${title}, page " counter(page); color: #888; font-size: 9pt; } }
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 10.5pt; line-height: 1.4; color: #111; }
    h1, h2, h3 { color: #0b6e63; }
    code { background: #f4f4f4; padding: 1px 3px; }
    pre { background: #f4f4f4; padding: 8px; overflow-x: auto; white-space: pre-wrap; }
    table { border-collapse: collapse; width: 100%; font-size: 9.5pt; }
    th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
    img { max-width: 100%; max-height: 22cm; }
  `);
  execFileSync("pandoc", [tmp, "-o", `${SUB}/${outName}.pdf`, "--pdf-engine=weasyprint", "--css", css, "-f", "gfm", "--resource-path", SUB], { cwd: SUB, env, stdio: "pipe" });
  rmSync(tmp);
  console.log(`  wrote submission/${outName}.pdf`);
}

console.log(`building the submission package (commit ${COMMIT})`);

// 1. Technical documentation
buildPdf("Technical_Documentation", "Mandate: Technical Documentation", [
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/PERMISSION_TIERS.md",
  "docs/DATA_MODEL.md",
  "docs/API.md",
]);

// 2. Security self-assessment
buildPdf("Security_Self_Assessment", "Mandate: Security Self-Assessment", [
  "docs/SECURITY_SELF_ASSESSMENT.md",
  "docs/THREAT_MODEL.md",
  "docs/COMPLIANCE.md",
]);

// 3. Execution evidence
buildPdf("Execution_Evidence", "Mandate: Execution Evidence", ["docs/EXECUTION_EVIDENCE.md"]);

// 4. Evaluation
buildPdf("Evaluation", "Mandate: Security Evaluation", ["docs/EVALUATION.md"]);

// 5. The deck, to PDF and PPTX
console.log("  rendering the deck...");
execFileSync(`${BIN}/marp`, ["deck/deck.md", "--pdf", "--allow-local-files", "-o", "Mandate_Deck.pdf"], { cwd: SUB, env, stdio: "pipe" });
try {
  execFileSync(`${BIN}/marp`, ["deck/deck.md", "--pptx", "--allow-local-files", "-o", "Mandate_Deck.pptx"], { cwd: SUB, env, stdio: "pipe" });
  console.log("  wrote submission/Mandate_Deck.pdf and .pptx");
} catch (err) {
  console.warn(`  PPTX export failed (PDF still produced): ${err instanceof Error ? err.message.split("\n")[0] : err}`);
}

// 6. Manifest
const manifest = `# Mandate submission package

${TEAM}. Repository: ${REPO}. Commit ${COMMIT}. Built ${DATE}.

This is a testnet research prototype. The vault contract is unaudited.

## Contents

| File | What it is |
|---|---|
| Technical_Documentation.pdf | Architecture, permission tiers, data model and API (required deliverable 1) |
| Security_Self_Assessment.pdf | The security self-assessment, threat model and compliance context (required deliverable 5) |
| Execution_Evidence.pdf | Real on-chain transaction hashes (required deliverable 6) |
| Evaluation.pdf | The measured attack-suite matrix |
| Mandate_Deck.pdf / .pptx | The presentation deck (required deliverable 2) |
| registration_summary.md | The registration form text |

The demo video script and the ten-minute talk track are in docs/DEMO_SCRIPT.md (required deliverable 3). The source code, README, deployment instructions and test suites are the repository itself (required deliverable 4).
`;
writeFileSync(`${SUB}/MANIFEST.md`, manifest);
console.log("  wrote submission/MANIFEST.md");

// 7. Zip
const zipName = `Mandate_Submission_${DATE}.zip`;
rmSync(`${SUB}/${zipName}`, { force: true });
execFileSync("zip", ["-q", "-r", zipName, "Technical_Documentation.pdf", "Security_Self_Assessment.pdf", "Execution_Evidence.pdf", "Evaluation.pdf", "Mandate_Deck.pdf", "MANIFEST.md", "registration_summary.md"].concat(existsSync(`${SUB}/Mandate_Deck.pptx`) ? ["Mandate_Deck.pptx"] : []), { cwd: SUB });
console.log(`  wrote submission/${zipName}`);
console.log("submission package complete");
