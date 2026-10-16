// Lightweight regression test: no Foundry runtime or external dependencies.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const hooks = { on: new Map(), once: new Map() };
const PATH = "flags.item-piles.system.quantityForPrice";
let delayedReady;

const getProperty = (obj, key) => key.split(".").reduce((value, part) => value?.[part], obj);
const setProperty = (obj, key, value) => {
  const parts = key.split(".");
  const leaf = parts.pop();
  const parent = parts.reduce((current, part) => current[part] ??= {}, obj);
  parent[leaf] = value;
};

function makeActor(id, isMerchant, stock, bundle, unitPrice) {
  const item = {
    id: "item-" + id,
    flags: { "item-piles": { system: { quantityForPrice: bundle } } },
    system: { quantity: stock, price: { value: unitPrice, denomination: "cp" } }
  };
  const actor = {
    id, uuid: "Actor." + id, name: id, items: [item], writes: [],
    getFlag: () => ({ enabled: true, type: isMerchant ? "merchant" : "pile" }),
    async updateEmbeddedDocuments(type, changes) {
      assert.equal(type, "Item");
      this.writes.push(changes);
      for (const change of changes) {
        assert.deepEqual(Object.keys(change).sort(), ["_id", PATH].sort());
        setProperty(item, PATH, change[PATH]);
      }
      return changes;
    }
  };
  item.parent = actor;
  return actor;
}

const merchant = makeActor("merchant", true, 8, 8, 6);
const ordinary = makeActor("ordinary", false, 7, 7, 9);
const tokenMerchant = makeActor("token", true, 12, 3, 4);
const game = {
  user: { isGM: true }, system: { id: "dnd5e" },
  actors: [merchant, ordinary],
  scenes: [{ tokens: [{ actorLink: false, actor: tokenMerchant }] }]
};
const sandbox = {
  game, console,
  foundry: { utils: { getProperty, setProperty, hasProperty: (obj, key) => getProperty(obj, key) !== undefined } },
  Hooks: {
    on: (name, handler) => hooks.on.set(name, handler),
    once: (name, handler) => hooks.once.set(name, handler)
  },
  setTimeout: callback => { delayedReady = callback; }
};
const file = path.resolve(__dirname, "../scripts/merchant-unit-prices.js");
vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
const nextTick = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  hooks.once.get("ready")();
  delayedReady();
  await nextTick();

  assert.equal(getProperty(merchant.items[0], PATH), 1, "merchant sells by the unit");
  assert.equal(getProperty(tokenMerchant.items[0], PATH), 1, "unlinked token merchant normalized");
  assert.equal(getProperty(ordinary.items[0], PATH), 7, "ordinary piles are unaffected");
  assert.equal(merchant.items[0].system.quantity, 8, "stock untouched");
  assert.equal(merchant.items[0].system.price.value, 6, "unit price untouched");
  assert.equal(merchant.writes.length, 1, "only one migration write");

  const changed = {};
  setProperty(changed, PATH, 5);
  hooks.on.get("preUpdateItem")(merchant.items[0], changed);
  assert.equal(getProperty(changed, PATH), 1, "bulk pricing cannot be restored on edit");

  const incoming = { [PATH]: 15 };
  hooks.on.get("preUpdateItem")(merchant.items[0], incoming);
  assert.equal(incoming[PATH], 1, "dotted updates normalize too");

  const newItem = {
    parent: merchant,
    updateSource(source) { this.saved = source; }
  };
  hooks.on.get("preCreateItem")(newItem, { [PATH]: 9 });
  assert.equal(newItem.saved[PATH], 1, "new merchant stock is sold by the unit");

  const addedMerchant = makeActor("added", true, 9, 9, 2);
  hooks.on.get("updateActor")(addedMerchant, { flags: { "item-piles": { data: { type: "merchant" } } } });
  await nextTick();
  assert.equal(getProperty(addedMerchant.items[0], PATH), 1, "merchant conversion is normalized");

  game.user.isGM = false;
  const playerChange = { [PATH]: 5 };
  hooks.on.get("preUpdateItem")(merchant.items[0], playerChange);
  assert.equal(playerChange[PATH], 5, "player does not write GM migration flags");

  console.log("Merchant unit-pricing regression: OK");
})().catch(error => { console.error(error); process.exitCode = 1; });
