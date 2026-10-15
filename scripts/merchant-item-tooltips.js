/**
 * LipatoS Item Piles — native D&D5e merchant item tooltips (Foundry 14).
 *
 * Item Piles merchant rows have display: contents and therefore no usable
 * rectangle for positioning. Bind only the icon and item-name cells.
 * D&D5e Tooltips5e reads the closest ".themed" ancestor to choose the theme:
 * mark these two cells as dark without restyling the whole merchant window.
 */
const LIP_TOOLTIP_CLASSES = "dnd5e2 dnd5e-tooltip item-tooltip document-tooltip";
const LIP_TOOLTIP_TARGETS = ".item-piles-img-container, .item-piles-name-container";

function lipBindMerchantTooltips(row, item) {
  if (!(row instanceof HTMLElement) ||
      !row.closest(".item-piles-merchant-sheet")) return;

  // Resolve the original Item document: avoids duplicate-name collisions and
  // delegates identification rules, item data, and markup to D&D5e itself.
  const uuid = item?.uuid;
  if (typeof uuid !== "string" || !/^[A-Za-z0-9_.-]+$/.test(uuid)) return;

  for (const target of row.querySelectorAll(LIP_TOOLTIP_TARGETS)) {
    // The system looks up element.closest(".themed"), then applies the
    // theme-dark class to #tooltip before rendering the rich item card.
    target.classList.remove("theme-light");
    target.classList.add("themed", "theme-dark");

    if (target.dataset.lipatosMerchantTooltipUuid === uuid) continue;

    target.dataset.tooltipHtml =
      '<section class="loading" data-uuid="' + uuid +
      '"><i class="fas fa-spinner fa-spin-pulse" inert></i></section>';
    target.dataset.tooltipClass = LIP_TOOLTIP_CLASSES;
    target.dataset.tooltipDirection = "LEFT";
    target.dataset.lipatosMerchantTooltipUuid = uuid;

    // Prevent conflicting browser / Item Piles fast tooltips.
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
