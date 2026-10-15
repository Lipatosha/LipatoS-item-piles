/**
 * LipatoS Item Piles 3.3.9 — merchant purchase/sale confirmation.
 *
 * Keep the native Item Piles transaction. Normalize the SAME Svelte writable
 * quantityToBuy used by getPaymentData and tradeItems; never merely clamp the
 * visible input or receipt label. Native D&D5e rich tooltips are attached only
 * to item images/names, and currency images match LipatoS inventory.
 */
const LIP_TR_DIALOG_PREFIX = "item-pile-buy-item-dialog-";
const LIP_TR_DIALOG_STATES = new Map();
const LIP_TR_TOOLTIP_CLASSES = "dnd5e2 dnd5e-tooltip item-tooltip document-tooltip";
const LIP_TR_COIN_ART = Object.freeze({
  cp: "modules/lipatos-three-currencies-global/assets/coins/copper-v2.webp",
  sp: "modules/lipatos-three-currencies-global/assets/coins/silver.webp",
  gp: "modules/lipatos-three-currencies-global/assets/coins/gold.webp"
});
const LIP_TR_COIN_FALLBACK = Object.freeze({
  cp: "modules/item-piles/icons/trade-currency/copper.png",
  sp: "modules/item-piles/icons/trade-currency/silver.png",
  gp: "modules/item-piles/icons/trade-currency/gold.png"
});

function lipTrRoot(app) {
  const el = app?.element;
  return el instanceof HTMLElement ? el :
    el?.[0] instanceof HTMLElement ? el[0] : document.getElementById(app?.id);
}

function lipTrItem(app) {
  return app?.options?.svelte?.props?.item ?? app?.svelte?.applicationShell?.item ?? null;
}

function lipTrStoreValue(store) {
  if (!store || typeof store.subscribe !== "function") return undefined;
  let value;
  const unsubscribe = store.subscribe(current => { value = current; });
  unsubscribe?.();
  return value;
}

function lipTrQuantityMax(item) {
  if (!item) return null;
  const selected = Number(lipTrStoreValue(item.selectedPriceGroup) ?? 0);
  const prices = lipTrStoreValue(item.prices);
  const perPurchase = Number(lipTrStoreValue(item.quantityForPrice) ?? 1);
  const stock = Number(lipTrStoreValue(item.quantity));
  const infinite = !!lipTrStoreValue(item.infiniteQuantity);
  const stockMax = infinite ? Infinity :
    (Number.isFinite(stock) && perPurchase > 0 ? Math.ceil(stock / perPurchase) : Infinity);
  const offerMax = Number(prices?.[selected]?.maxQuantity ?? Infinity);
  const max = Math.min(stockMax, Number.isNaN(offerMax) ? Infinity : offerMax);
  return Number.isFinite(max) ? Math.max(0, Math.floor(max)) : Infinity;
}

function lipTrQuantityInput(root) {
  const header = lipTrHero(root);
  return header?.querySelector('input[type="number"]') ?? null;
}

function lipTrHero(root) {
  const summary = lipTrSummary(root);
  return summary?.previousElementSibling ?? null;
}

function lipTrSummary(root) {
  return root.querySelector(".item-piles-bottom-divider[style*='grid-template-columns']");
}

function lipTrClampQuantity(value, max, fallback=1) {
  let amount = Number(value);
  if (!Number.isFinite(amount)) amount = fallback;
  amount = Math.max(1, Math.trunc(amount));
  if (Number.isFinite(max)) amount = Math.min(amount, Math.max(1, max));
  return amount;
}

function lipTrCommitQuantity(state, { force=false }={}) {
  const input = lipTrQuantityInput(state.root);
  const store = lipTrItem(state.app)?.quantityToBuy;
  if (!input || !store || typeof store.set !== "function") return;

  // While the user temporarily clears the field, wait until blur/confirmation;
  // otherwise normalize immediately so displayed prices follow the entered sum.
  if (!force && input.value.trim() === "") return;
  const max = lipTrQuantityMax(lipTrItem(state.app));
  const previous = Number(lipTrStoreValue(store) ?? 1);
  const amount = lipTrClampQuantity(input.value, max, previous);

  if (max !== null && Number.isFinite(max) && max > 0) {
    input.max = String(max);
  }
  input.min = "1";
  input.step = "1";
  if (input.value !== String(amount)) input.value = String(amount);
  if (previous !== amount) store.set(amount);
  state.quantity = amount;
  lipTrUpdate(state);
}

function lipTrCurrentQuantity(state) {
  const item = lipTrItem(state.app);
  const value = lipTrStoreValue(item?.quantityToBuy);
  const max = lipTrQuantityMax(item);
  return lipTrClampQuantity(value ?? state.quantity ?? 1, max);
}

function lipTrCurrencyFromImage(source) {
  const path = String(source || "").toLowerCase().split(/[?#]/, 1)[0];
  if (/(?:coin-engraved-waves-copper|copper-v2|\/copper)(?:\.webp|\.png)$/.test(path)) return "cp";
  if (/(?:coin-engraved-moon-silver|\/silver)(?:\.webp|\.png)$/.test(path)) return "sp";
  if (/(?:coin-embossed-crown-gold|\/gold)(?:\.webp|\.png)$/.test(path)) return "gp";
  return null;
}

function lipTrSwapCoinImages(root) {
  const custom = game.modules.get("lipatos-three-currencies-global")?.active;
  const icons = custom ? LIP_TR_COIN_ART : LIP_TR_COIN_FALLBACK;
  for (const img of root.querySelectorAll("img")) {
    const code = lipTrCurrencyFromImage(img.getAttribute("src"));
    if (!code) continue;
    if (img.getAttribute("src") !== icons[code]) img.setAttribute("src", icons[code]);
    img.classList.add("lipatos-trade-coin-icon");
    img.closest(".item-piles-img-container")?.classList.add("lipatos-trade-coin-holder");
  }
}

function lipTrBindItemTooltip(target, uuid) {
  if (!(target instanceof HTMLElement) || !uuid) return;
  target.classList.remove("theme-light");
  target.classList.add("themed", "theme-dark");
  if (target.dataset.lipatosMerchantTooltipUuid === uuid) return;
  target.dataset.tooltipHtml =
    '<section class="loading" data-uuid="' + uuid +
    '"><i class="fas fa-spinner fa-spin-pulse" inert></i></section>';
  target.dataset.tooltipClass = LIP_TR_TOOLTIP_CLASSES;
  target.dataset.tooltipDirection = "LEFT";
  target.dataset.lipatosMerchantTooltipUuid = uuid;
  target.removeAttribute("data-fast-tooltip");
  target.removeAttribute("title");
}

function lipTrBindItemTooltips(state) {
  const uuid = lipTrItem(state.app)?.item?.uuid;
  if (typeof uuid !== "string" || !/^[A-Za-z0-9_.-]+$/.test(uuid)) return;
  const header = lipTrHero(state.root)?.firstElementChild;
  if (header) {
    lipTrBindItemTooltip(header.querySelector(".item-piles-img-container"), uuid);
    lipTrBindItemTooltip(header.querySelector("span"), uuid);
  }
  const receipt = state.root.querySelector(".lipatos-trade-item-receipt");
  if (receipt) {
    lipTrBindItemTooltip(receipt.querySelector(".lipatos-trade-item-icon"), uuid);
    lipTrBindItemTooltip(receipt.querySelector(".lipatos-trade-item-label"), uuid);
  }
}

function lipTrFixReceipt(state) {
  // The native Item Piles content grid has two strong labels then two divs.
  const summary = lipTrSummary(state.root);
  if (!(summary instanceof HTMLElement)) return;
  const columns = Array.from(summary.children).filter(el =>
    el.tagName === "DIV" && !el.classList.contains("lipatos-trade-item-receipt")
  );
  if (columns.length !== 2) return;
  const hero = summary.previousElementSibling;
  const header = hero?.firstElementChild;
  const picture = header?.querySelector(".item-piles-img-container img");
  const label = header?.querySelector("span");
  if (!picture || !label) return;
  summary.classList.add("lipatos-trade-summary");
  columns[1].classList.add("lipatos-trade-original-receipt");

  let receipt = Array.from(summary.children).find(el =>
    el.classList.contains("lipatos-trade-item-receipt")
  );
  if (!receipt) {
    receipt = document.createElement("div");
    receipt.className = "lipatos-trade-item-receipt";
    const img = document.createElement("img");
    img.className = "lipatos-trade-item-icon";
    img.alt = "";
    const name = document.createElement("span");
    name.className = "lipatos-trade-item-label";
    const qty = document.createElement("span");
    qty.className = "lipatos-trade-item-count";
    receipt.append(img, name, qty);
    summary.append(receipt);
  }
  const img = receipt.querySelector(".lipatos-trade-item-icon");
  const name = receipt.querySelector(".lipatos-trade-item-label");
  const count = receipt.querySelector(".lipatos-trade-item-count");
  const src = picture.getAttribute("src") || "";
  const title = label.textContent.trim();
  const quantity = lipTrCurrentQuantity(state);
  if (img.getAttribute("src") !== src) img.setAttribute("src", src);
  if (name.textContent !== title) name.textContent = title;
  if (count.textContent !== "× " + quantity) count.textContent = "× " + quantity;
}

function lipTrUpdate(state) {
  if (!state.root?.isConnected) return;
  lipTrSwapCoinImages(state.root);
  lipTrFixReceipt(state);
  lipTrBindItemTooltips(state);
}

function lipTrInstall(app) {
  if (!app?.id?.startsWith(LIP_TR_DIALOG_PREFIX) || game.system?.id !== "dnd5e") return;
  const root = lipTrRoot(app);
  if (!root) return;
  let state = LIP_TR_DIALOG_STATES.get(app.id);
  if (!state || state.root !== root) {
    if (state) lipTrDispose(state.app);
    state = { app, root, observer: null, onInput: null, onSubmit: null, unsubscribe: [], quantity: 1 };
    // Capture before Svelte's change/input binding reads the control value.
    state.onInput = event => {
      if (event.target?.matches?.('input[type="number"]')) {
        lipTrCommitQuantity(state, { force: event.type === "change" });
      }
    };
    state.onSubmit = event => {
      if (event.target?.closest?.("footer.sheet-footer button:not(:last-child)")) {
        lipTrCommitQuantity(state, { force: true });
      }
    };
    root.addEventListener("input", state.onInput, true);
    root.addEventListener("change", state.onInput, true);
    root.addEventListener("click", state.onSubmit, true);
    state.observer = new MutationObserver(() => lipTrUpdate(state));
    state.observer.observe(root, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ["src"]
    });
    LIP_TR_DIALOG_STATES.set(app.id, state);
    const item = lipTrItem(app);
    for (const store of [item?.quantityToBuy, item?.selectedPriceGroup, item?.prices]) {
      if (typeof store?.subscribe !== "function") continue;
      const unsub = store.subscribe(() => queueMicrotask(() => lipTrUpdate(state)));
      state.unsubscribe.push(unsub);
    }
  }
  state.app = app;
  lipTrUpdate(state);
}

function lipTrDispose(app) {
  const state = LIP_TR_DIALOG_STATES.get(app?.id);
  if (!state) return;
  state.observer?.disconnect();
  state.root.removeEventListener("input", state.onInput, true);
  state.root.removeEventListener("change", state.onInput, true);
  state.root.removeEventListener("click", state.onSubmit, true);
  for (const unsubscribe of state.unsubscribe) unsubscribe();
  LIP_TR_DIALOG_STATES.delete(app.id);
}

Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") return;
  for (const app of Object.values(ui.windows)) lipTrInstall(app);
});
Hooks.on("renderApplication", app => {
  if (!app?.id?.startsWith(LIP_TR_DIALOG_PREFIX)) return;
  setTimeout(() => lipTrInstall(app), 0);
});
Hooks.on("closeApplication", lipTrDispose);
