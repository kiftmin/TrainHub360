// orval rewrites lib/api-zod/src/index.ts on every codegen run, exporting both generated folders
// with `export *`. Those two folders export the same name for every request body, which is an
// ambiguous re-export and fails the build. This hook restores the hand-written index from its
// template, so codegen is idempotent and the ambiguity never lands.
const fs = require("node:fs");
const path = require("node:path");

const target = path.resolve(__dirname, "..", "api-zod", "src");
fs.copyFileSync(path.join(target, "index.template.ts"), path.join(target, "index.ts"));
