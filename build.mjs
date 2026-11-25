import { build } from "esbuild";
import { polyfillNode } from "esbuild-plugin-polyfill-node";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";

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
cpSync("index.html", "docs/index.html"); // language gate (English default)
cpSync("ja.html", "docs/ja.html");
cpSync("en.html", "docs/en.html");
cpSync("src/style.css", "docs/style.css");
cpSync("ql1-eagle.png", "docs/ql1-eagle.png"); // QL1 eagle logo (favicon + header mark)
writeFileSync("docs/CNAME", "staking.qql1.com\n"); // GitHub Pages custom domain
console.log("docs/ ready");
