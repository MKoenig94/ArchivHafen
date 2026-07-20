import { build } from "esbuild";

await build({
  entryPoints: ["src/server/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/server/index.js",
  packages: "external",
  sourcemap: true,
});
