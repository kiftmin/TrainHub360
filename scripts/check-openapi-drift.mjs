// Round 8 / Phase 6: the OpenAPI document is the contract the generated clients are built from.
// A route added without a spec entry is invisible to those clients; a spec entry for a route that
// was renamed or deleted fails at runtime. This check lists both directions and exits non-zero so
// CI stops the drift.
//
// It is deliberately a simple text comparison, not a validator: the routes are declared as string
// literals in one router, and the spec stores paths as two-space-indented keys with method keys
// below them. Parameter *names* are not compared (they differ across the two by design) — the
// method plus the path shape is what has to match.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routesFile = path.join(root, "lib", "api", "src", "routes", "index.ts");
const specFile = path.join(root, "lib", "api-spec", "openapi.yaml");

const METHODS = new Set(["get", "post", "put", "patch", "delete"]);

/** `/courses/:id/attempts` and `/courses/{courseId}/attempts` both become `/courses/{}/attempts`. */
function normalise(pathname) {
  return pathname.replace(/:[A-Za-z0-9_]+/g, "{}").replace(/\{[A-Za-z0-9_]+\}/g, "{}");
}

function key(method, pathname) {
  return `${method.toUpperCase()} ${normalise(pathname)}`;
}

async function registeredRoutes() {
  const source = await fs.readFile(routesFile, "utf8");
  const found = new Map();
  const pattern = /router\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    const method = match[1].toLowerCase();
    const pathname = match[2];
    found.set(key(method, pathname), `${method.toUpperCase()} ${pathname}`);
  }
  return found;
}

async function specifiedRoutes() {
  const lines = (await fs.readFile(specFile, "utf8")).split(/\r?\n/);
  const found = new Map();
  let currentPath = null;
  for (const line of lines) {
    const pathMatch = line.match(/^ {2}(\/[^:]*):\s*$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }
    if (/^ {2}\S/.test(line)) {
      // A new top-level key (components:, tags:, ...) ends the paths block.
      currentPath = null;
      continue;
    }
    const methodMatch = line.match(/^ {4}(get|post|put|patch|delete):\s*$/);
    if (currentPath && methodMatch && METHODS.has(methodMatch[1])) {
      found.set(key(methodMatch[1], currentPath), `${methodMatch[1].toUpperCase()} ${currentPath}`);
    }
  }
  return found;
}

const [routes, spec] = await Promise.all([registeredRoutes(), specifiedRoutes()]);
const undocumented = [...routes].filter(([k]) => !spec.has(k)).map(([, label]) => label).sort();
const stale = [...spec].filter(([k]) => !routes.has(k)).map(([, label]) => label).sort();

if (!undocumented.length && !stale.length) {
  console.log(`openapi drift: none (${routes.size} operations match)`);
  process.exit(0);
}

if (undocumented.length) {
  console.error(`\n${undocumented.length} registered route(s) missing from lib/api-spec/openapi.yaml:`);
  for (const label of undocumented) console.error(`  - ${label}`);
}
if (stale.length) {
  console.error(`\n${stale.length} spec operation(s) with no registered route:`);
  for (const label of stale) console.error(`  - ${label}`);
}
console.error("\nUpdate lib/api-spec/openapi.yaml (and regenerate the clients) so the two agree.");
process.exit(1);
