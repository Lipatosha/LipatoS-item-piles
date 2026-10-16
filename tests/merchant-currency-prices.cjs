const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const bundle = fs.readFileSync(path.join(__dirname, "../dist/item-piles.js"), "utf8");
function extract(start, next) {
  const offset = bundle.indexOf(start);
  const end = bundle.indexOf(next, offset + start.length);
  assert.ok(offset >= 0 && end > offset, "Foundry Item Piles bundle function boundaries are intact");
  return bundle.slice(offset, end);
}
function getProperty(object, field) {
  return field.split(".").reduce((obj, name) => obj?.[name], object);
}
const nativePrice = () => 999; // simulate missing/incorrect D&D5e adapter
const mockItem = (price, denomination) => ({
  system: { price: { value: price, denomination }, quantity: 8 }
});
const currency = (code, rate, primary) => ({
  name: code, type: "attribute", abbreviation: "{#}" + code.toUpperCase(),
  data: { path: "system.currency." + code }, exchangeRate: rate,
  primary, secondary: false, quantity: 100
});
const currencies = [
  currency("gp", 1, true),
  currency("sp", .1, false),
  currency("cp", .01, false)
];
const context = {
  game: { system: { id: "dnd5e" } },
  foundry: { utils: { getProperty } },
  getCurrencyList: () => currencies,
  SYSTEMS: { DATA: { ITEM_COST_TRANSFORMER: () => nativePrice() } },
  getItemCost: item => item.system.price.value,
  debug: () => {}
};
vm.createContext(context);
vm.runInContext(extract("function getCostOfItem(", "function getItemFlagPriceData("), context);
assert.equal(context.getCostOfItem(mockItem(6, "cp"), currencies), .06,
  "6 cp is 0.06 gp, not 6 gp");
assert.equal(context.getCostOfItem(mockItem(4, "sp"), currencies), .4,
  "4 silver pieces are 0.4 gp");
assert.equal(context.getCostOfItem(mockItem(3, "gp"), currencies), 3,
  "3 gold pieces remain 3 gp");
assert.equal(context.getCostOfItem(mockItem(0, "cp"), currencies), 0);
assert.equal(context.getCostOfItem(mockItem(6, "cp"), currencies) * 8, .48,
  "eight units are priced as eight times the single-unit price");

context.getSmallestExchangeRate = cs => Math.min(...cs.map(c => c.exchangeRate));
context.getDecimalDifferenceBetweenExchangeRates = () => 5;
context.roundToDecimals = (value, digits) => Number(value.toFixed(digits));
vm.runInContext(extract("function getPriceArray(", "function getCurrenciesAbbreviations("), context);
const one = context.getPriceArray(.06, currencies);
const two = context.getPriceArray(.12, currencies);
assert.equal(one.find(c => c.data?.path.endsWith(".cp"))?.cost, 6,
  "6 cp is displayed as six copper coins");
assert.equal(one.find(c => c.data?.path.endsWith(".gp"))?.cost ?? 0, 0,
  "6 cp is not displayed as gold");
assert.equal(two.find(c => c.data?.path.endsWith(".sp"))?.cost, 1,
  "12 cp is displayed as 1 sp");
assert.equal(two.find(c => c.data?.path.endsWith(".cp"))?.cost, 2,
  "12 cp is displayed with another 2 cp");

const coinScript = fs.readFileSync(path.join(__dirname, "../scripts/merchant-currency-prices.js"), "utf8");
let onReady, scheduled;
const api = {
  CURRENCIES: [currency("gp", 1, true)],
  writes: 0,
  async setCurrencies(list) {
    this.CURRENCIES = list;
    this.writes += 1;
  }
};
const repairContext = {
  game: { system: { id: "dnd5e" }, user: { isGM: true }, itempiles: { API: api } },
  foundry: { utils: { deepClone: obj => JSON.parse(JSON.stringify(obj)) } },
  Hooks: { once: (name, fn) => { assert.equal(name, "ready"); onReady = fn; } },
  setTimeout: (fn, ms) => { assert.equal(ms, 1800); scheduled = fn; },
  console
};
vm.runInNewContext(coinScript, repairContext);
assert.equal(typeof onReady, "function");

(async () => {
  onReady();
  scheduled();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(api.writes, 1, "legacy GP-only world is migrated exactly once");
  assert.equal(api.CURRENCIES.find(c => c.data.path.endsWith(".cp")).exchangeRate, .01);
  assert.equal(api.CURRENCIES.find(c => c.data.path.endsWith(".sp")).exchangeRate, .1);
  assert.equal(api.CURRENCIES.find(c => c.data.path.endsWith(".gp")).exchangeRate, 1);
  scheduled();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(api.writes, 1, "correct settings are not rewritten");

  api.CURRENCIES.find(c => c.data.path.endsWith(".cp")).exchangeRate = 1;
  scheduled();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(api.CURRENCIES.find(c => c.data.path.endsWith(".cp")).exchangeRate, .01,
    "incorrect old copper rate is repaired");

  console.log("Item Piles D&D5e merchant denominations: OK");
})().catch(e => { console.error(e); process.exitCode = 1; });
