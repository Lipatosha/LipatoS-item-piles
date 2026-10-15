/**
 * LipatoS - Currency Exchange for Item Piles merchants.
 * Keeps exchange configuration separate from core Item Piles pile-data.
 * D&D 5e (cp/sp/gp); all exchanges are validated and performed by the active GM.
 */
const LIP_EX_MODULE = "item-piles";
const LIP_EX_FLAG = "lipatosCurrencyExchangeEnabled";
const LIP_EX_CHANNEL = "module.item-piles";
const LIP_EX_DENOM = Object.freeze({ cp: 1, sp: 10, gp: 100 });
const LIP_EX_NAMES = Object.freeze({ cp: "Медь", sp: "Серебро", gp: "Золото" });
// Use the same custom coin art as the LipatoS character inventory.
// Fall back to Item Piles icons when the three-currencies add-on is inactive.
const LIP_EX_COIN_ART = Object.freeze({
  cp: "modules/lipatos-three-currencies-global/assets/coins/copper-v2.webp",
  sp: "modules/lipatos-three-currencies-global/assets/coins/silver.webp",
  gp: "modules/lipatos-three-currencies-global/assets/coins/gold.webp"
});
const LIP_EX_COIN_FALLBACK = Object.freeze({
  cp: "modules/item-piles/icons/trade-currency/copper.png",
  sp: "modules/item-piles/icons/trade-currency/silver.png",
  gp: "modules/item-piles/icons/trade-currency/gold.png"
});
function lipExCoinIcon(code) {
  return game.modules.get("lipatos-three-currencies-global")?.active
    ? LIP_EX_COIN_ART[code] : LIP_EX_COIN_FALLBACK[code];
}
const lipExWindows = new Map();
const lipExPending = new Map();
const lipExLocks = new Map();

function lipExMerchant(actor) {
  const data = actor?.getFlag?.(LIP_EX_MODULE, "data");
  return !!(data?.enabled && data?.type === "merchant" && actor.getFlag(LIP_EX_MODULE, LIP_EX_FLAG));
}

function lipExActorCurrency(actor, code) {
  const raw = actor?.system?.currency?.[code];
  const value = Number(raw?.value ?? raw ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : NaN;
}

function lipExQuote(from, to, quantity) {
  if (!Object.hasOwn(LIP_EX_DENOM, from) || !Object.hasOwn(LIP_EX_DENOM, to) || from === to) {
    throw new Error("Выберите две разные валюты.");
  }
  const n = Number(quantity);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error("Введите целое положительное количество монет.");
  const copper = n * LIP_EX_DENOM[from];
  if (!Number.isSafeInteger(copper) || copper % LIP_EX_DENOM[to] !== 0) {
    throw new Error("Для такого обмена требуется кратное количество монет. Например, 10 медных = 1 серебряная.");
  }
  const amount = copper / LIP_EX_DENOM[to];
  if (!Number.isSafeInteger(amount)) throw new Error("Слишком большая сумма.");
  return amount;
}

function lipExMainGM() {
  return game.users.filter(u => u.active && u.isGM).sort((a, b) => a.id.localeCompare(b.id))[0];
}

function lipExRoot(app) {
  const el = app?.element;
  return (el instanceof HTMLElement ? el : el?.[0] instanceof HTMLElement ? el[0] : document.getElementById(app?.id));
}

async function lipExResolveActor(uuid) {
  if (typeof uuid !== "string" || uuid.length > 300) return null;
  const doc = await fromUuid(uuid).catch(() => null);
  return doc?.documentName === "Actor" ? doc : null;
}

async function lipExExecute(request) {
  const merchant = await lipExResolveActor(request?.merchantUuid);
  const customer = await lipExResolveActor(request?.actorUuid);
  const user = game.users.get(request?.userId);
  if (!game.user.isGM) throw new Error("Обмен может выполнить только мастер.");
  if (!merchant || !lipExMerchant(merchant)) throw new Error("Этот торговец не обменивает валюту.");
  if (!customer || !user?.active || !(user.isGM || customer.testUserPermission(user, "OWNER"))) {
    throw new Error("Нет доступа к валюте выбранного персонажа.");
  }
  if (game.system.id !== "dnd5e") throw new Error("Обмен поддерживается для D&D 5e.");
  const from = request.from, to = request.to;
  const give = Number(request.quantity);
  const receive = lipExQuote(from, to, give);
  const key = customer.uuid;
  const previous = lipExLocks.get(key) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    // Recheck against up-to-date document data inside the per-actor queue.
    if (!lipExMerchant(merchant)) throw new Error("Торговец больше не оказывает услугу обмена.");
    const balance = lipExActorCurrency(customer, from);
    const targetBalance = lipExActorCurrency(customer, to);
    if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(targetBalance)) {
      throw new Error("Некорректное значение валюты персонажа.");
    }
    if (balance < give) throw new Error("У персонажа недостаточно монет для обмена.");
    if (!Number.isSafeInteger(targetBalance + receive)) throw new Error("Превышен допустимый размер кошелька.");
    await customer.update({
      ["system.currency." + from]: balance - give,
      ["system.currency." + to]: targetBalance + receive
    }, { lipatosCurrencyExchange: true });
    return "Обменено: " + give + " " + LIP_EX_NAMES[from] + " → " + receive + " " + LIP_EX_NAMES[to] + ".";
  });
  lipExLocks.set(key, task);
  try { return await task; }
  finally { if (lipExLocks.get(key) === task) lipExLocks.delete(key); }
}

async function lipExOnSocket(data) {
  if (!data || data.lipatosExchange !== 1) return;
  if (data.kind === "response") {
    if (data.userId !== game.user.id) return;
    const state = lipExPending.get(data.requestId);
    if (!state) return;
    lipExPending.delete(data.requestId);
    state.busy = false;
    lipExRefresh(state);
    if (data.ok) ui.notifications.info(data.message);
    else ui.notifications.warn(data.message || "Не удалось обменять монеты.");
    return;
  }
  if (data.kind !== "request" || !game.user.isGM || lipExMainGM()?.id !== game.user.id) return;
  let message, ok;
  try { message = await lipExExecute(data); ok = true; }
  catch (error) { ok = false; message = error.message || String(error); }
  game.socket.emit(LIP_EX_CHANNEL, {
    lipatosExchange: 1, kind: "response", requestId: data.requestId,
    userId: data.userId, ok, message
  });
}

function lipExCurrentActor(app) {
  const recipient = app.svelte?.applicationShell?.store?.recipient || app.recipient;
  if (recipient && (game.user.isGM || recipient.testUserPermission(game.user, "OWNER"))) return recipient;
  return game.user.character || null;
}

function lipExUpdateReceiveOptions(pane) {
  const give = pane?.querySelector("[name='lip-ex-from']");
  const receive = pane?.querySelector("[name='lip-ex-to']");
  if (!give || !receive) return;
  const choices = Object.keys(LIP_EX_NAMES).filter(code => code !== give.value);
  if (Array.from(receive.options).map(o => o.value).join("|") === choices.join("|")) return;
  const previous = receive.value;
  receive.replaceChildren(...choices.map(code => {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = LIP_EX_NAMES[code];
    return option;
  }));
  receive.value = choices.includes(previous) ? previous : choices[0];
}

function lipExRefresh(state) {
  if (!state?.pane?.isConnected) return;
  const actor = lipExCurrentActor(state.app);
  state.actor = actor;
  for (const code of ["cp", "sp", "gp"]) {
    const node = state.pane.querySelector("[data-balance='" + code + "']");
    if (node) {
      const n = lipExActorCurrency(actor, code);
      const next = Number.isSafeInteger(n) ? n.toLocaleString("ru-RU") : "—";
      if (node.textContent !== next) node.textContent = next;
    }
  }
  const who = state.pane.querySelector("[data-exchange-person]");
  if (who) {
    const next = actor ? actor.name : "Персонаж не выбран";
    if (who.textContent !== next) who.textContent = next;
  }
  lipExUpdateReceiveOptions(state.pane);
  const from = state.pane.querySelector("[name='lip-ex-from']")?.value;
  const to = state.pane.querySelector("[name='lip-ex-to']")?.value;
  const quantity = state.pane.querySelector("[name='lip-ex-amount']")?.value;
  const preview = state.pane.querySelector("[data-exchange-preview]");
  const button = state.pane.querySelector("[data-exchange-confirm]");
  if (!preview || !button) return;
  let reason = "";
  let received = 0;
  try {
    received = lipExQuote(from, to, quantity);
    if (!actor) reason = "Сначала выберите своего персонажа.";
    else if (lipExActorCurrency(actor, from) < Number(quantity)) reason = "Недостаточно монет.";
  } catch (error) { reason = error.message; }
  const previewText = reason || ("Получите: " + received.toLocaleString("ru-RU") + " " + LIP_EX_NAMES[to].toLowerCase() + " (" + quantity + " " + LIP_EX_NAMES[from].toLowerCase() + " к обмену).");
  if (preview.textContent !== previewText) preview.textContent = previewText;
  preview.classList.toggle("lip-ex-error", !!reason);
  button.disabled = !!reason || state.busy;
  const caption = state.busy ? "Обмениваем…" : "Обменять монеты";
  if (button.textContent !== caption) button.textContent = caption;
}

async function lipExSubmit(state) {
  if (state.busy || !lipExMerchant(state.app.merchant)) return;
  const actor = lipExCurrentActor(state.app);
  if (!actor) { ui.notifications.warn("Сначала выберите своего персонажа."); return; }
  const from = state.pane.querySelector("[name='lip-ex-from']").value;
  const to = state.pane.querySelector("[name='lip-ex-to']").value;
  const quantity = Number(state.pane.querySelector("[name='lip-ex-amount']").value);
  try {
    const received = lipExQuote(from, to, quantity);
    if (lipExActorCurrency(actor, from) < quantity) throw new Error("Недостаточно монет.");
    if (!Number.isSafeInteger(lipExActorCurrency(actor, to) + received)) throw new Error("Превышен размер кошелька.");
  } catch (error) { ui.notifications.warn(error.message); return; }
  const request = {
    lipatosExchange: 1, kind: "request", requestId: foundry.utils.randomID(),
    userId: game.user.id, merchantUuid: state.app.merchant.uuid, actorUuid: actor.uuid,
    from, to, quantity
  };
  state.busy = true;
  lipExRefresh(state);
  if (game.user.isGM) {
    try { ui.notifications.info(await lipExExecute(request)); }
    catch (error) { ui.notifications.warn(error.message); }
    finally { state.busy = false; lipExRefresh(state); }
  } else {
    if (!lipExMainGM()) {
      state.busy = false;
      lipExRefresh(state);
      ui.notifications.warn("Для обмена должен быть подключён мастер.");
      return;
    }
    lipExPending.set(request.requestId, state);
    game.socket.emit(LIP_EX_CHANNEL, request);
  }
}

function lipExMakePane(state) {
  const pane = document.createElement("section");
  pane.className = "lipatos-exchange-panel";
  const icon = code => lipExCoinIcon(code);
  pane.innerHTML = `
    <header class="lip-ex-heading">
      <h2><i class="fas fa-coins"></i> Обмен монет</h2>
      <span class="lip-ex-rate">Курс: 100 меди = 10 серебра = 1 золото</span>
    </header>
    <div class="lip-ex-who">Кошелёк: <strong data-exchange-person></strong></div>
    <div class="lip-ex-balances">
      <div class="lip-ex-balance">
        <img src="${icon("cp")}" alt="Медь">
        <span class="lip-ex-balance-text"><span>Медь</span><strong data-balance="cp">—</strong></span>
      </div>
      <div class="lip-ex-balance">
        <img src="${icon("sp")}" alt="Серебро">
        <span class="lip-ex-balance-text"><span>Серебро</span><strong data-balance="sp">—</strong></span>
      </div>
      <div class="lip-ex-balance">
        <img src="${icon("gp")}" alt="Золото">
        <span class="lip-ex-balance-text"><span>Золото</span><strong data-balance="gp">—</strong></span>
      </div>
    </div>
    <div class="lip-ex-controls">
      <label>Отдаёте<select name="lip-ex-from">
        <option value="cp">Медь</option>
        <option value="sp">Серебро</option>
        <option value="gp">Золото</option>
      </select></label>
      <label>Получаете<select name="lip-ex-to">
        <option value="sp">Серебро</option>
        <option value="cp">Медь</option>
        <option value="gp">Золото</option>
      </select></label>
      <label>Количество монет<input type="number" min="1" step="1" name="lip-ex-amount" value="10" inputmode="numeric"></label>
    </div>
    <div class="lip-ex-action">
      <p class="lip-ex-preview" data-exchange-preview></p>
      <button type="button" data-exchange-confirm>Обменять монеты</button>
    </div>`;
  pane.querySelectorAll("input, select").forEach(el => {
    el.addEventListener("input", () => lipExRefresh(state));
    el.addEventListener("change", () => lipExRefresh(state));
  });
  pane.querySelector("[data-exchange-confirm]").addEventListener("click", () => lipExSubmit(state));
  return pane;
}

function lipExCurrencyCode(label) {
  const text = String(label || "").trim().toLowerCase();
  if (["медь", "copper", "cp"].includes(text)) return "cp";
  if (["серебро", "silver", "sp"].includes(text)) return "sp";
  if (["золото", "gold", "gp"].includes(text)) return "gp";
  return null;
}
function lipExMerchantCoinIcons(app) {
  const root = lipExRoot(app);
  if (!root) return;
  for (const entry of root.querySelectorAll(".item-pile-merchant-content .item-piles-currency-list [data-fast-tooltip]")) {
    const img = entry.querySelector("img.item-piles-img");
    const code = lipExCurrencyCode(entry.dataset.fastTooltip);
    if (!img || !code) continue;
    const newPath = lipExCoinIcon(code);
    if (img.getAttribute("src") !== newPath) img.setAttribute("src", newPath);
    img.classList.add("lipatos-merchant-coin-icon");
    img.closest(".item-piles-img-container")?.classList.add("lipatos-merchant-coin-holder");
  }
  for (const img of root.querySelectorAll(".item-pile-merchant-content img[src*='/trade-currency/']")) {
    const path = (img.getAttribute("src") || "").toLowerCase();
    const code = path.includes("copper") ? "cp" : path.includes("silver") ? "sp" : path.includes("gold") ? "gp" : null;
    if (!code) continue;
    const newPath = lipExCoinIcon(code);
    if (img.getAttribute("src") !== newPath) img.setAttribute("src", newPath);
    img.classList.add("lipatos-merchant-coin-icon");
    img.closest(".item-piles-img-container")?.classList.add("lipatos-merchant-coin-holder");
  }
}

function lipExMountMerchant(app) {
  const root = lipExRoot(app);
  if (!root) return;
  if (!lipExMerchant(app.merchant) || game.system.id !== "dnd5e") {
    root.classList.remove("lipatos-exchange-open");
    root.querySelector(".lipatos-exchange-tab")?.remove();
    root.querySelector(".lipatos-exchange-panel")?.remove();
    lipExWindows.delete(app.id);
    return;
  }
  const nav = root?.querySelector("nav.tabs");
  const content = root?.querySelector(".item-pile-merchant-content");
  if (!nav || !content) return;
  let state = lipExWindows.get(app.id);
  if (!state) {
    state = { app, pane: null, busy: false };
    lipExWindows.set(app.id, state);
  }
  state.app = app;
  if (!nav.querySelector(".lipatos-exchange-tab")) {
    const tab = document.createElement("div");
    tab.className = "item item-piles-flexrow item-piles-clickable-link underscore lipatos-exchange-tab";
    tab.textContent = "Обмен монет";
    tab.title = "Разменять медь, серебро или золото";
    tab.addEventListener("click", () => {
      root.classList.add("lipatos-exchange-open");
      nav.querySelectorAll(".item.active").forEach(node => node.classList.remove("active"));
      tab.classList.add("active");
      lipExRefresh(state);
    });
    nav.append(tab);
  }
  if (!nav.dataset.lipatosExchangeWired) {
    nav.dataset.lipatosExchangeWired = "1";
    nav.addEventListener("click", event => {
      if (event.target.closest(".lipatos-exchange-tab")) return;
      root.classList.remove("lipatos-exchange-open");
      nav.querySelector(".lipatos-exchange-tab")?.classList.remove("active");
    }, true);
  }
  if (!state.pane?.isConnected || state.pane.parentElement !== content.parentElement) {
    state.pane = lipExMakePane(state);
    content.after(state.pane);
  }
  lipExRefresh(state);
}

function lipExMountConfig(app) {
  if (!game.user.isGM || game.system.id !== "dnd5e") return;
  const root = lipExRoot(app);
  const form = root?.querySelector("form.item-piles-config-container");
  const actor = app.options?.svelte?.props?.pileActor || game.actors.get(app.id.split("item-pile-config-")[1]?.split("-")[0]);
  if (!form || !actor) return;
  if (!form.dataset.lipatosExchangeWired) {
    form.dataset.lipatosExchangeWired = "1";
    form.addEventListener("submit", () => {
      const desired = root.querySelector("[data-lipatos-exchange-checkbox]")?.checked;
      const remembered = app._lipatosExchangePending;
      const enabled = typeof desired === "boolean" ? desired : remembered;
      if (typeof enabled !== "boolean") return;
      actor.setFlag(LIP_EX_MODULE, LIP_EX_FLAG, enabled).catch(error =>
        ui.notifications.error("Не удалось сохранить настройку обмена валют: " + error.message));
    }, true);
  }
  const configTab = root.querySelector("section.tab-body > .tab");
  const typeSelector = Array.from(configTab?.querySelectorAll("select") || []).find(el => Array.from(el.options).some(o => o.value === "merchant"));
  if (!typeSelector || typeSelector.value !== "merchant" || configTab.querySelector("[data-lipatos-exchange-setting]")) return;
  const wrapper = document.createElement("div");
  wrapper.className = "form-group lipatos-exchange-setting";
  wrapper.dataset.lipatosExchangeSetting = "1";
  const label = document.createElement("label");
  label.textContent = "Обмен валют";
  label.title = "Позволить игрокам обменивать медь, серебро и золото у этого торговца.";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.dataset.lipatosExchangeCheckbox = "1";
  checkbox.checked = app._lipatosExchangePending ?? !!actor.getFlag(LIP_EX_MODULE, LIP_EX_FLAG);
  checkbox.addEventListener("change", () => { app._lipatosExchangePending = checkbox.checked; });
  wrapper.append(label, checkbox);
  typeSelector.closest(".form-group")?.after(wrapper);
}

function lipExEnhance(app) {
  if (!app?.id) return;
  if (app.id.startsWith("item-pile-config-")) {
    lipExMountConfig(app);
  } else if (app.id.startsWith("item-pile-merchant-")) {
    lipExMountMerchant(app);
    lipExMerchantCoinIcons(app);
  }
}

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") return;
  game.socket.on(LIP_EX_CHANNEL, lipExOnSocket);
  for (const app of Object.values(ui.windows)) lipExEnhance(app);
});
Hooks.on("renderApplication", app => {
  if (!app?.id?.startsWith("item-pile-")) return;
  setTimeout(() => lipExEnhance(app), 0);
});
Hooks.on("closeApplication", app => {
  if (!app?.id) return;
  lipExWindows.delete(app.id);
});
Hooks.on("updateActor", actor => {
  for (const state of lipExWindows.values()) {
    if (state.app.merchant?.uuid === actor.uuid) lipExMountMerchant(state.app);
    else if (lipExCurrentActor(state.app)?.uuid === actor.uuid) lipExRefresh(state);
  }
});
// Svelte can mount/recreate settings tabs after renderApplication.
// Observe only Item Piles windows, and re-attach when needed; never recreate existing controls.
Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") return;
  const observer = new MutationObserver(records => {
    const apps = Object.values(ui.windows).filter(app => app.id?.startsWith("item-pile-config-") || app.id?.startsWith("item-pile-merchant-"));
    if (!apps.length) return;
    for (const app of apps) {
      const root = lipExRoot(app);
      if (!root) continue;
      if (records.some(record => root === record.target || root.contains(record.target))) lipExEnhance(app);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
});
