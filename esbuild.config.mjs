import { build } from "esbuild";
import { cpSync } from "fs";

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/mcp-server/index.ts"],
    outfile: "dist/mcp-server/index.js",
  }),
  build({
    ...shared,
    entryPoints: ["src/hooks/context-loader.ts"],
    outfile: "dist/hooks/context-loader.js",
  }),
  build({
    ...shared,
    entryPoints: ["src/hooks/scope-enforcer.ts"],
    outfile: "dist/hooks/scope-enforcer.js",
  }),
  build({
    ...shared,
    entryPoints: ["src/hooks/passive-monitor.ts"],
    outfile: "dist/hooks/passive-monitor.js",
  }),
  build({
    ...shared,
    entryPoints: ["src/hooks/checkpoint.ts"],
    outfile: "dist/hooks/checkpoint.js",
  }),
  build({
    ...shared,
    entryPoints: ["src/hooks/arm-cleanup.ts"],
    outfile: "dist/hooks/arm-cleanup.js",
  }),
]);

// Copy WASM sidecar for node-sqlite3-wasm
cpSync(
  "node_modules/node-sqlite3-wasm/dist/node-sqlite3-wasm.wasm",
  "dist/mcp-server/node-sqlite3-wasm.wasm"
);
