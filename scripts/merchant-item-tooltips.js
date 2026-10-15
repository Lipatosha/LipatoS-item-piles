/**
 * LipatoS Item Piles — native D&D5e merchant item tooltips.
 * Uses exactly the same Foundry/D&D5e rich tooltip as the actor inventory.
 *
 * Item Piles renders merchant rows with display: contents, so the row itself
 * has no usable screen rectangle. Tooltips must belong to the icon and
 * name elements, never to the whole merchant row.
 */
const LIP_TOOLTIP_CLASSES = "dnd5e2 dnd5e-tooltip item-tooltip document-tooltip";
const LIP_TOOLTIP_TARGETS = ".item-piles-img-container, .item-piles-name-container";

function lipBindMerchantTooltips(row, item) {
  if (!(row instanceof HTMLElement) ||
      !row.closest(".item-piles-merchant-sheet")) return;

  // Native D&D5e tooltips resolve the original Item document by UUID. This
  // handles identical item names and identified/unidentified items correctly.
  const uuid = item?.uuid;
  if (!uuid || !/^[A-Za-z0-9_.-]+$/.test(uuid)) return;

  for (const target of row.querySelectorAll(LIP_TOOLTIP_TARGETS)) {
    if (target.dataset.lipatosMerchantTooltipUuid === uuid) continue;

    // Matches dnd5e 6.0.x PrimarySheet5e._applyItemTooltips and
    // dnd5e.utils.loadingTooltip, so the SYSTEM renders the real card.
    target.dataset.tooltipHtml =
      '<section class="loading" data-uuid="' + uuid +
      '"><i class="fas fa-spinner fa-spin-pulse" inert></i></section>';
    target.dataset.tooltipClass = LIP_TOOLTIP_CLASSES;
    target.dataset.tooltipDirection = "LEFT";
    target.dataset.lipatosMerchantTooltipUuid = uuid;

    // Don't show a second Item Piles 'fast tooltip' over the native card.
    target.removeAttribute("data-fast-tooltip");
    target.removeAttribute("title");
  }
}

Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") return;
  const renderHook = game.itempiles?.hooks?.RENDER_MERCHANT_ITEM;
  if (!renderHook) {
    console.warn("LipatoS Item Piles | Merchant item render hook unavailable");
    return;
  }
  Hooks.on(renderHook, lipBindMerchantTooltips);
});
