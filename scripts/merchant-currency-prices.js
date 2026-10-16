/**
 * Restore the standard D&D5e gp/sp/cp denominations in Item Piles.
 *
 * Item Piles stores costs in gold-piece equivalents. If an old world has
 * only GP configured, even a correctly normalized 6 cp item may render as
 * 0.06 GP (or previously as 6 GP if the adapter was missing).
 * Keep customized names/icons and unrelated currencies but repair missing
 * or invalid canonical currency paths/rates. Never alter actor wallets.
 */
const LIP_MERCHANT_COIN_DEFS = Object.freeze({
  gp: {
    type: "attribute", name: "DND5E.CurrencyGP",
    img: "icons/commodities/currency/coin-embossed-crown-gold.webp",
    abbreviation: "{#}GP", data: { path: "system.currency.gp" },
    primary: true, exchangeRate: 1
  },
  sp: {
    type: "attribute", name: "DND5E.CurrencySP",
    img: "icons/commodities/currency/coin-engraved-moon-silver.webp",
    abbreviation: "{#}SP", data: { path: "system.currency.sp" },
    primary: false, exchangeRate: 0.1
  },
  cp: {
    type: "attribute", name: "DND5E.CurrencyCP",
    img: "icons/commodities/currency/coin-engraved-waves-copper.webp",
    abbreviation: "{#}CP", data: { path: "system.currency.cp" },
    primary: false, exchangeRate: 0.01
  }
});

function lipMerchantCurrencyCode(entry) {
  const path = String(entry?.data?.path ?? "").toLowerCase().trim();
  const match = path.match(/^system\.currency\.(gp|sp|cp)$/);
  return entry?.type === "attribute" ? match?.[1] ?? null : null;
}

function lipMerchantRepairCurrencies(currencies) {
  const next = foundry.utils.deepClone(currencies);
  let changed = false;
  for (const [code, def] of Object.entries(LIP_MERCHANT_COIN_DEFS)) {
    const existing = next.find(entry => lipMerchantCurrencyCode(entry) === code);
    if (!existing) {
      next.push(foundry.utils.deepClone(def));
      changed = true;
      continue;
    }
    // The current campaign intentionally uses D&D 5e's three-coin economy.
    if (existing.exchangeRate !== def.exchangeRate) {
      existing.exchangeRate = def.exchangeRate;
      changed = true;
    }
    if (existing.primary !== def.primary) {
      existing.primary = def.primary;
      changed = true;
    }
    if (!existing.name) {
      existing.name = def.name;
      changed = true;
    }
    if (!existing.img) {
      existing.img = def.img;
      changed = true;
    }
    if (!existing.abbreviation) {
      existing.abbreviation = def.abbreviation;
      changed = true;
    }
  }
  // Only one primary currency can be used for arithmetic decomposition.
  for (const entry of next) {
    if (!lipMerchantCurrencyCode(entry) && entry.primary) {
      entry.primary = false;
      changed = true;
    }
  }
  return { currencies: next, changed };
}

async function lipMerchantEnsureCurrencies() {
  if (!game.user?.isGM || game.system?.id !== "dnd5e") return;
  const api = game.itempiles?.API;
  if (!api || typeof api.setCurrencies !== "function" || !Array.isArray(api.CURRENCIES)) {
    console.warn("LipatoS Item Piles | Currency API is unavailable; cannot validate gp/sp/cp.");
    return;
  }
  try {
    const result = lipMerchantRepairCurrencies(api.CURRENCIES);
    if (!result.changed) return;
    await api.setCurrencies(result.currencies);
    console.info("LipatoS Item Piles | Восстановлены валюты и курсы gp/sp/cp для магазина.");
  } catch (error) {
    console.error("LipatoS Item Piles | Не удалось восстановить валюты магазина", error);
  }
}

Hooks.once("ready", () => {
  if (game.user?.isGM && game.system?.id === "dnd5e") {
    // Currency-removal integration from the three-currencies module runs
    // immediately and again after ~1.2s. Run after those updates.
    setTimeout(() => void lipMerchantEnsureCurrencies(), 1800);
  }
});
