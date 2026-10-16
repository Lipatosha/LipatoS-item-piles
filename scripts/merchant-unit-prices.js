/**
 * LipatoS — Item Piles merchant unit prices.
 *
 * D&D5e's system.price is a price PER ITEM. Item Piles also supports selling
 * bundles via flags.item-piles.system.quantityForPrice. For LipatoS merchants
 * we always sell single units: stock 8 at 6 cp means 8 × 6 cp, not one
 * bundle containing 8 items for 6 cp.
 *
 * Only merchant inventory is normalized. Item prices, stock quantities,
 * price modifiers, and non-merchant actors are never rewritten.
 */
const LIP_UNIT_FLAG = "flags.item-piles.system.quantityForPrice";
const LIP_UNIT_PENDING = new Set();

function lipUnitIsMerchant(actor) {
  const data = actor?.getFlag?.("item-piles", "data");
  return Boolean(data?.enabled && data?.type === "merchant");
}

function lipUnitValue(item) {
  return foundry.utils.getProperty(item, LIP_UNIT_FLAG);
}

function lipUnitNeedsFix(item) {
  const value = lipUnitValue(item);
  return value !== undefined && value !== null && value !== 1;
}

function lipUnitReadChange(changes) {
  return Object.hasOwn(changes, LIP_UNIT_FLAG)
    ? changes[LIP_UNIT_FLAG]
    : foundry.utils.getProperty(changes, LIP_UNIT_FLAG);
}

function lipUnitForceChange(changes) {
  if (Object.hasOwn(changes, LIP_UNIT_FLAG)) {
    changes[LIP_UNIT_FLAG] = 1;
  } else {
    foundry.utils.setProperty(changes, LIP_UNIT_FLAG, 1);
  }
}

async function lipUnitNormalizeMerchant(actor) {
  if (!game.user?.isGM || !lipUnitIsMerchant(actor) || !actor?.items) return;
  const key = actor.uuid ?? actor.id;
  if (LIP_UNIT_PENDING.has(key)) return;
  LIP_UNIT_PENDING.add(key);
  try {
    const updates = [...actor.items]
      .filter(lipUnitNeedsFix)
      .map(item => ({ _id: item.id, [LIP_UNIT_FLAG]: 1 }));
    if (!updates.length) return;
    await actor.updateEmbeddedDocuments("Item", updates, { lipatosMerchantUnitPricing: true });
    console.info(`LipatoS Item Piles | ${actor.name}: poштучные цены восстановлены у ${updates.length} товаров.`);
  } catch (error) {
    console.error(`LipatoS Item Piles | Не удалось исправить цены торговца ${actor.name}`, error);
  } finally {
    LIP_UNIT_PENDING.delete(key);
  }
}

async function lipUnitNormalizeExisting() {
  if (!game.user?.isGM || game.system?.id !== "dnd5e") return;
  const seen = new Set();
  const visit = async actor => {
    if (!actor || !lipUnitIsMerchant(actor)) return;
    const key = actor.uuid ?? actor.id;
    if (seen.has(key)) return;
    seen.add(key);
    await lipUnitNormalizeMerchant(actor);
  };

  for (const actor of game.actors ?? []) await visit(actor);
  // Unlinked merchant tokens have independent embedded inventories.
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens ?? []) {
      if (!token.actorLink) await visit(token.actor);
    }
  }
}

Hooks.on("preCreateItem", (item, data) => {
  if (!game.user?.isGM || game.system?.id !== "dnd5e" || !lipUnitIsMerchant(item.parent)) return;
  const value = lipUnitReadChange(data);
  if (value !== undefined && value !== null && value !== 1) {
    item.updateSource({ [LIP_UNIT_FLAG]: 1 });
  }
});

Hooks.on("preUpdateItem", (item, changes) => {
  if (!game.user?.isGM || game.system?.id !== "dnd5e" || !lipUnitIsMerchant(item.parent)) return;
  const next = lipUnitReadChange(changes);
  if (next !== undefined && next !== null && next !== 1 || lipUnitNeedsFix(item)) {
    lipUnitForceChange(changes);
  }
});

Hooks.on("updateActor", (actor, changes) => {
  if (!game.user?.isGM || game.system?.id !== "dnd5e" || !lipUnitIsMerchant(actor)) return;
  const keys = Object.keys(changes);
  if (foundry.utils.hasProperty(changes, "flags.item-piles.data")
      || keys.some(key => key.startsWith("flags.item-piles.data"))) {
    void lipUnitNormalizeMerchant(actor);
  }
});

Hooks.on("createToken", token => {
  if (game.user?.isGM && game.system?.id === "dnd5e" && !token.actorLink) {
    void lipUnitNormalizeMerchant(token.actor);
  }
});

Hooks.once("ready", () => {
  if (game.user?.isGM && game.system?.id === "dnd5e") {
    // Wait until the initial Foundry/world migrations have settled.
    setTimeout(() => void lipUnitNormalizeExisting(), 500);
  }
});
