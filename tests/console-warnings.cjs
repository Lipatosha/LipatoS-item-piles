const fs = require("node:fs");
const assert = require("node:assert/strict");
const js=fs.readFileSync("dist/item-piles.js","utf8");
assert.ok(js.includes("if (foundry.nue.Tour.tourInProgress) return;"),
  "Fast-tooltip tour detection must use the Foundry 14 namespace");
assert.ok(!js.includes("if (Tour.tourInProgress) return;"),
  "Must not access the deprecated global Tour");
assert.ok(!js.includes("sourceMappingURL=item-piles.js.map"),
  "Should not reference missing source map in the compiled bundle");
const manifest=JSON.parse(fs.readFileSync("module.json","utf8"));
assert.equal(manifest.version,"3.3.12");
assert.ok(manifest.esmodules.includes("dist/item-piles.js"));
console.log("Item Piles: v14 Tour and missing source map checks passed.");
