import { readdirSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { scenarioSchema, type Scenario } from "./types.js";

export const CATALOG_DIR = new URL("../catalog/", import.meta.url).pathname;

export function loadCatalog(dir = CATALOG_DIR): Scenario[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => scenarioSchema.parse(parse(readFileSync(`${dir}${f}`, "utf8"))));
}
