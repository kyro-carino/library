const fs = require("fs");
const html = fs.readFileSync("index.html", "utf8");
const js = fs.readFileSync("script.js", "utf8");
let fail = 0;
const ck = (n, c, x = "") => {
  console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "   <-- " + x));
  if (!c) fail++;
};
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
ck("no duplicate ids", ids.length === new Set(ids).size, [...new Set(ids.filter((i) => ids.filter((x) => x === i).length > 1))].join(","));
const used = new Set(
  [...js.matchAll(/\$\(\s*["']#([A-Za-z][\w-]*)["']/g)].map((m) => m[1]).concat(
    [...js.matchAll(/getElementById\(\s*["']([\w-]+)["']/g)].map((m) => m[1])
  )
);
const dynamic = new Set(
  [...js.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]).concat(
    [...js.matchAll(/\bid=\\?['"]([\w-]+)/g)].map((m) => m[1])
  )
);
const missing = [...used].filter((i) => !ids.includes(i) && !dynamic.has(i) && !i.endsWith("-")).sort();
ck("script ids exist", missing.length === 0, missing.join(","));
ck("return desk ids", ["return-pane-loan", "return-pane-details", "return-bar", "return-confirm-btn", "return-search", "return-date-input"].every((i) => ids.includes(i)));
ck("no return wizard", !ids.includes("return-rail") && !ids.includes("return-stage-1"));
const labels = [...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]);
const badLab = labels.filter((l) => !ids.includes(l));
ck("label for targets exist", badLab.length === 0, badLab.join(","));
process.exit(fail ? 1 : 0);
