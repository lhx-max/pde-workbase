import { build } from "esbuild";

// Single-file bundle for the Appwrite deployment: everything inlined,
// node builtins external. sharp never enters — the function uses jimp.
await build({
  bundle: true,
  entryPoints: ["./src/main.ts"],
  format: "cjs",
  outfile: "./dist/main.js",
  platform: "node",
  target: "node22",
  external: ["node:*"],
  banner: { js: "// canvas-coi — generated bundle, edit src/ not this file" },
});
