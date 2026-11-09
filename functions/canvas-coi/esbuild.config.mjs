import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";

// Single-file CJS bundle for the Appwrite node-22 runtime: the whole app
// domain is inlined from TypeScript source; node builtins and native `sharp`
// stay external — Appwrite's build installs sharp's Linux binary from
// package.json on the platform, never a checked-in macOS binary.
await build({
  bundle: true,
  entryPoints: ["./src/main.ts"],
  format: "cjs",
  outfile: "./dist/main.cjs",
  platform: "node",
  target: "node22",
  external: ["node:*", "sharp", "fsevents"],
  banner: { js: "// canvas-coi — generated bundle, edit src/ not this file" },
});

// Deterministic module-key sanitization: esbuild labels bundled modules with
// workspace-relative paths (`../../apps/...`, `node_modules/.pnpm/...`). They
// are display labels only — rewriting them to stable ids changes nothing at
// runtime while keeping developer/repo layout out of the uploaded artifact.
let src = readFileSync("./dist/main.cjs", "utf8");
const moduleIds = new Map();
const idFor = (key) => {
  let id = moduleIds.get(key);
  if (!id) { id = `m${moduleIds.size.toString(36)}`; moduleIds.set(key, id); }
  return id;
};
// `// ../../path/file.ts` banner comments
src = src.replace(/^\/\/ ((?:\.\.\/|\.\/|\/)[^\n]+)$/gm, (_m, key) => `// ${idFor(key)}`);
// `"../../path/file.js"(exports, module) {` loader object keys
src = src.replace(/^(\s*)"([^"]*\/[^"]*)"(\([^)]*\) \{)$/gm, (_m, indent, key, tail) => `${indent}"${idFor(key)}"${tail}`);

for (const banned of ["/Users/", "/private/tmp", process.env.HOME ?? "\0"]) {
  if (banned.length > 1 && src.includes(banned))
    throw new Error(`bundle contains an absolute local path fragment: ${banned}`);
}
writeFileSync("./dist/main.cjs", src);

const bytes = Buffer.from(src, "utf8");
const manifest = {
  $schema: "designai/function-manifest/v1",
  appId: "canvas",
  functionId: "canvas-coi",
  packageVersion: "0.2.0",
  runtime: "node-22",
  entrypoint: "dist/main.cjs",
  bundleSha256: createHash("sha256").update(bytes).digest("hex"),
  bundleBytes: bytes.byteLength,
  bundledAt: new Date().toISOString(),
  routing: { type: "http", methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] },
  scopes: ["databases.read", "collections.read", "documents.read", "documents.write", "buckets.read", "files.read", "files.write"],
  resources: {
    projectId: "<APPWRITE_PROJECT_ID>",
    databaseId: "<APPWRITE_DATABASE_ID>",
    bucketId: "<APPWRITE_BUCKET_ID>",
    runtimeCollectionId: "<APPWRITE_RUNTIME_COLLECTION>",
    runtimeNamespace: "<CANVAS_RUNTIME_NAMESPACE>",
  },
  env: {
    platformInjected: ["APPWRITE_FUNCTION_API_ENDPOINT", "APPWRITE_FUNCTION_PROJECT_ID", "x-appwrite-key(request header)"],
    required: [
      "APPWRITE_ENDPOINT", "APPWRITE_PROJECT_ID", "APPWRITE_DATABASE_ID", "APPWRITE_BUCKET_ID",
      "APPWRITE_RUNTIME_COLLECTION", "CANVAS_RUNTIME_NAMESPACE",
      "MAV_API_TRANSPORT=appwrite + MAV_APPWRITE_ENDPOINT + MAV_APPWRITE_PROJECT_ID (or MAV_API_ORIGIN)",
    ],
    optional: ["APPWRITE_API_KEY (fallback key when platform does not inject x-appwrite-key)",
      "APP_WRITE_GRANTS_JSON", "CANVAS_TRUSTED_APP_ORIGINS", "CANVAS_WEB_URL",
      "CANVAS_IMAGE_APP_ORIGIN + CANVAS_IMAGE_APPLICATION_ID (legacy external Image seam)"],
  },
};
writeFileSync("./dist/function.manifest.json", JSON.stringify(manifest, null, 2) + "\n");
// Upload closure: workspace packages are bundled; Linux installs native sharp.
mkdirSync('./.deploy', {recursive: true});
copyFileSync('./dist/main.cjs', './.deploy/main.cjs');
copyFileSync('./dist/function.manifest.json', './.deploy/function.manifest.json');
const pkg=JSON.parse(readFileSync('./package.json','utf8'));
writeFileSync('./.deploy/package.json', JSON.stringify({name:'designai-canvas-function',version:pkg.version,private:true,type:'commonjs',main:'main.cjs',dependencies:{sharp:pkg.dependencies.sharp}},null,2)+'\n');
copyFileSync('../../LICENSE','./.deploy/LICENSE');
console.log(`bundle ${bytes.byteLength} bytes sha256 ${manifest.bundleSha256} modules ${moduleIds.size}`);
