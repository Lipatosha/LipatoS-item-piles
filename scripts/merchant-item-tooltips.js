/**
 * Item Piles merchant hover cards (Foundry v14 / dnd5e).
 * Uses Item Piles' own merchant-item hover hooks and the real Item document,
 * never row text (so duplicate item names still show the correct description).
 */
const LIP_TIP_STATE = { target: null, item: null, timer: null, element: null };

function lipTipHide(target = null) {
  if (target && LIP_TIP_STATE.target && LIP_TIP_STATE.target !== target) return;
  if (LIP_TIP_STATE.timer) clearTimeout(LIP_TIP_STATE.timer);
  LIP_TIP_STATE.timer = null;
  LIP_TIP_STATE.element?.remove();
  LIP_TIP_STATE.element = null;
  LIP_TIP_STATE.target = null;
  LIP_TIP_STATE.item = null;
}

function lipTipDescription(item) {
  let source = item?.system?.description?.value ?? item?.system?.description?.chat ?? "";
  if (!game.user?.isGM && item?.system?.identified === false) {
    source = item?.system?.description?.unidentified ??
      item?.system?.unidentified?.description ?? "";
  }
  const doc = new DOMParser().parseFromString(String(source), "text/html");
  // Do not display GM-only content, event handlers or executable elements.
  doc.body.querySelectorAll("script,style,iframe,object,embed,template,svg,math,form,input,button,video,audio,section.secret,.secret,[data-secret],[data-visibility='gm']")
    .forEach(node => node.remove());
  const allowed = new Set(["P","DIV","SPAN","B","STRONG","I","EM","U","S","BR","HR","UL","OL","LI","BLOCKQUOTE","H1","H2","H3","H4","H5","H6","TABLE","THEAD","TBODY","TR","TD","TH","CODE","PRE"]);
  for (const node of Array.from(doc.body.querySelectorAll("*")).reverse()) {
    if (!node.isConnected) continue;
    if (!allowed.has(node.tagName)) {
      node.replaceWith(...Array.from(node.childNodes));
    } else {
      for (const attr of Array.from(node.attributes)) node.removeAttribute(attr.name);
    }
  }
  return doc.body.innerHTML.trim().slice(0, 10000);
}

function lipTipShow(target, item) {
  if (!(target instanceof HTMLElement) || !target.isConnected ||
      !target.closest(".item-piles-merchant-sheet") || !item) return;
  if (LIP_TIP_STATE.target === target && LIP_TIP_STATE.item === item) return;
  lipTipHide();
  LIP_TIP_STATE.target = target;
  LIP_TIP_STATE.item = item;
  LIP_TIP_STATE.timer = setTimeout(() => {
    if (!target.isConnected || LIP_TIP_STATE.target !== target) return;
    const tip = document.createElement("aside");
    tip.className = "lipatos-merchant-item-tooltip";
    tip.setAttribute("role", "tooltip");
    const header = document.createElement("div");
    header.className = "lipatos-merchant-tooltip-header";
    const image = document.createElement("img");
    image.alt = "";
    image.src = item.img || "icons/svg/item-bag.svg";
    const title = document.createElement("strong");
    title.textContent = item.name || "Предмет";
    header.append(image, title);
    tip.append(header);
    const details = document.createElement("div");
    details.className = "lipatos-merchant-tooltip-body";
    const safe = lipTipDescription(item);
    if (safe) details.innerHTML = safe;
    else details.textContent = "Описание отсутствует.";
    tip.append(details);
    document.body.append(tip);
    const box = target.getBoundingClientRect();
    const tbox = tip.getBoundingClientRect();
    let left = box.right + 12;
    if (left + tbox.width > window.innerWidth - 12) left = box.left - tbox.width - 12;
    let top = Math.min(box.top, window.innerHeight - tbox.height - 12);
    tip.style.left = Math.max(10, left) + "px";
    tip.style.top = Math.max(10, top) + "px";
    LIP_TIP_STATE.element = tip;
  }, 320);
}

Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") return;
  const hooks = game.itempiles?.hooks;
  if (!hooks?.HOVER_MERCHANT_ITEM || !hooks?.LEAVE_MERCHANT_ITEM) {
    console.warn("LipatoS Item Piles | Merchant hover hooks unavailable");
    return;
  }
  Hooks.on(hooks.HOVER_MERCHANT_ITEM, (target, item) => lipTipShow(target, item));
  Hooks.on(hooks.LEAVE_MERCHANT_ITEM, target => lipTipHide(target));
});

Hooks.on("closeApplication", app => {
  if (app?.id?.startsWith("item-pile-merchant-")) lipTipHide();
});
