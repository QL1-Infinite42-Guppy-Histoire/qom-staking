import { build } from "esbuild";
import { polyfillNode } from "esbuild-plugin-polyfill-node";
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("docs", { recursive: true });
await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  outfile: "docs/app.js",
  plugins: [polyfillNode()],
  logLevel: "info",
});
cpSync("index.html", "docs/index.html");
cpSync("src/style.css", "docs/style.css");
console.log("docs/ ready");
