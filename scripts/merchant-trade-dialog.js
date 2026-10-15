/**
 * LipatoS — Merchant trade confirmation UI for Foundry 14 / D&D5e.
 *
 * Preserve Item Piles' native transaction and price computation. Its vanilla
 * merchant confirmation can show misleading coin-like item entries on the
 * receiving side: represent the selected item there using the same item
 * image/name shown in the dialog header, for BOTH buy and sell transactions.
 *
 * Coins anywhere in the confirmation use the same art as LipatoS inventory.
 */
const LIP_TR_DIALOG_PREFIX = "item-pile-buy-item-dialog-";
const LIP_TR_DIALOG_STATES = new Map();
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
  const element = app?.element;
  return element instanceof HTMLElement ? element
    : element?.[0] instanceof HTMLElement ? element[0]
    : document.getElementById(app?.id);
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

function lipTrFixReceipt(root) {
  // Exact grid from TradeMerchantItemDialogShell, not any other Item Piles
  // dialog. Its two STRONG labels are followed by two DIV content columns.
  const summary = root.querySelector(
    ".item-piles-bottom-divider[style*='grid-template-columns']"
  );
  if (!(summary instanceof HTMLElement)) return;

  const originalColumns = Array.from(summary.children).filter(element =>
    element.tagName === "DIV" && !element.classList.contains("lipatos-trade-item-receipt")
  );
  if (originalColumns.length !== 2) return;
  const originalRight = originalColumns[1];
  const hero = summary.previousElementSibling;
  const itemHeader = hero?.firstElementChild;
  const itemImage = itemHeader?.querySelector(".item-piles-img-container img");
  const itemLabel = itemHeader?.querySelector("span");
  if (!itemImage || !itemLabel) return;

  summary.classList.add("lipatos-trade-summary");
  originalRight.classList.add("lipatos-trade-original-receipt");

  let itemReceipt = Array.from(summary.children).find(el =>
    el.classList.contains("lipatos-trade-item-receipt")
  );
  if (!itemReceipt) {
    itemReceipt = document.createElement("div");
    itemReceipt.className = "lipatos-trade-item-receipt";
    const picture = document.createElement("img");
    picture.className = "lipatos-trade-item-icon";
    picture.alt = "";
    const details = document.createElement("span");
    details.className = "lipatos-trade-item-label";
    const count = document.createElement("span");
    count.className = "lipatos-trade-item-count";
    itemReceipt.append(picture, details, count);
    summary.append(itemReceipt);
  }

  const picture = itemReceipt.querySelector(".lipatos-trade-item-icon");
  const details = itemReceipt.querySelector(".lipatos-trade-item-label");
  const count = itemReceipt.querySelector(".lipatos-trade-item-count");
  const src = itemImage.getAttribute("src") || "";
  const title = itemLabel.textContent.trim();
  const requested = Number(hero?.querySelector('input[type="number"]')?.value);
  const quantity = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  if (picture.getAttribute("src") !== src) picture.setAttribute("src", src);
  if (details.textContent !== title) details.textContent = title;
  const quantityText = "× " + quantity;
  if (count.textContent !== quantityText) count.textContent = quantityText;
}

function lipTrUpdate(state) {
  if (!state.root?.isConnected) return;
  lipTrSwapCoinImages(state.root);
  lipTrFixReceipt(state.root);
}

function lipTrInstall(app) {
  if (!app?.id?.startsWith(LIP_TR_DIALOG_PREFIX) || game.system.id !== "dnd5e") return;
  const root = lipTrRoot(app);
  if (!root) return;
  let state = LIP_TR_DIALOG_STATES.get(app.id);
  if (!state || state.root !== root) {
    state?.observer.disconnect();
    state?.root.removeEventListener("change", state.onChange, true);
    state?.root.removeEventListener("input", state.onChange, true);
    state = { root, observer: null, onChange: null };
    state.onChange = event => {
      if (event.target?.matches?.('input[type="number"]')) {
        queueMicrotask(() => lipTrUpdate(state));
      }
    };
    root.addEventListener("change", state.onChange, true);
    root.addEventListener("input", state.onChange, true);
    state.observer = new MutationObserver(() => lipTrUpdate(state));
    state.observer.observe(root, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ["src"]
    });
    LIP_TR_DIALOG_STATES.set(app.id, state);
  }
  lipTrUpdate(state);
}

function lipTrDispose(app) {
  const state = LIP_TR_DIALOG_STATES.get(app?.id);
  if (!state) return;
  state.observer.disconnect();
  state.root.removeEventListener("change", state.onChange, true);
  state.root.removeEventListener("input", state.onChange, true);
  LIP_TR_DIALOG_STATES.delete(app.id);
}

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") return;
  for (const app of Object.values(ui.windows)) lipTrInstall(app);
});
Hooks.on("renderApplication", app => {
  if (!app?.id?.startsWith(LIP_TR_DIALOG_PREFIX)) return;
  setTimeout(() => lipTrInstall(app), 0);
});
Hooks.on("closeApplication", lipTrDispose);
