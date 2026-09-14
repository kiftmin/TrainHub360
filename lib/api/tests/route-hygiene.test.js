import test from "node:test";
import assert from "node:assert/strict";

test("no duplicate route registrations", async () => {
  const { router } = await import("../dist/routes/index.js");
  const seen = new Map();
  const duplicates = [];
  for (const layer of router.stack ?? []) {
    const route = layer.route;
    if (!route) continue;
    const methods = Object.keys(route.methods ?? {}).filter((m) => route.methods[m]);
    for (const method of methods) {
      const key = `${method.toUpperCase()} ${route.path}`;
      if (seen.has(key)) duplicates.push(key);
      else seen.set(key, true);
    }
  }
  assert.deepEqual(duplicates, [], `duplicate routes registered: ${duplicates.join(", ")}`);
});
