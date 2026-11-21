// `generated/api` (the zod schemas) and `generated/types` (the TypeScript types) export the same
// name for every request body, so `export *` of both is ambiguous and fails the build. The schemas
// are the useful half at runtime; a body's TypeScript type is reachable from its schema with
// z.infer, and from @workspace/api-client-react where a plain type is wanted.
export * from "./generated/api";
