/**
 * Package options for a proposal.
 *
 * An option is a named subset of the quote's line items. The model only chooses
 * which items go in which package; prices are always computed here from the
 * items, so an option can never promise a number the quote does not support.
 */

export const PROPOSAL_SECTIONS = [
  "overview",
  "scope",
  "timeline",
  "investment",
  "delivery",
  "risks",
  "next",
];

const MAX_OPTIONS = 3;

function cleanText(value, max) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Validate options returned by the model. Keeps only real item indexes, drops
 * empty or duplicate packages, and always ends up with at most one
 * "recommended" package. Returns [] when fewer than two usable options remain,
 * because a single package is just the quote again.
 *
 * Each option also stores the descriptions of the items it picked. Database
 * order is not guaranteed, and the owner may edit items later, so pricing
 * re-resolves items by description when an index no longer lines up.
 *
 * @param {Array} raw    model output: [{ name, summary, itemIndexes, recommended }]
 * @param {Array} items  the quote's line items, in the order the model saw them
 */
export function normalizeProposalOptions(raw, items) {
  const itemCount = Array.isArray(items) ? items.length : 0;
  if (!Array.isArray(raw) || itemCount < 2) {
    return [];
  }

  const seen = new Set();
  const options = [];

  for (const entry of raw) {
    if (options.length >= MAX_OPTIONS) break;
    const indexes = Array.isArray(entry?.itemIndexes)
      ? [
          ...new Set(
            entry.itemIndexes
              .map((n) => Number(n))
              .filter((n) => Number.isInteger(n) && n >= 0 && n < itemCount),
          ),
        ].sort((a, b) => a - b)
      : [];
    const name = cleanText(entry?.name, 40);
    if (!indexes.length || !name) continue;

    const key = indexes.join(",");
    if (seen.has(key)) continue;
    seen.add(key);

    options.push({
      id: `opt-${options.length + 1}`,
      name,
      summary: cleanText(entry?.summary, 220),
      itemIndexes: indexes,
      itemDescriptions: indexes.map((i) => String(items[i]?.description ?? "")),
      recommended: entry?.recommended === true,
    });
  }

  if (options.length < 2) return [];

  let recommendedSeen = false;
  for (const option of options) {
    if (option.recommended && !recommendedSeen) {
      recommendedSeen = true;
    } else {
      option.recommended = false;
    }
  }
  return options;
}

/**
 * Resolve an option's items against the quote as it is now. Returns the picked
 * amounts, or null when an item can no longer be found (it was edited or
 * removed), in which case the option cannot be priced honestly.
 */
function resolveOptionAmounts(option, items) {
  const list = items || [];
  const used = new Set();
  const amounts = [];

  (option?.itemIndexes || []).forEach((index, position) => {
    const wanted = option.itemDescriptions?.[position];
    let at = -1;
    if (list[index] && !used.has(index) && (wanted == null || list[index].description === wanted)) {
      at = index;
    } else if (wanted != null) {
      at = list.findIndex((item, i) => !used.has(i) && item.description === wanted);
    }
    if (at >= 0) {
      used.add(at);
      amounts.push(Number(list[at].amount) || 0);
    }
  });

  return amounts.length === (option?.itemIndexes || []).length ? amounts : null;
}

/**
 * Price of one option, or null if it cannot be priced. The package that
 * contains every item costs exactly the quote total; a smaller package costs
 * its share of the item amounts, applied to the quote total so tax or rounding
 * on the quote carries through.
 */
export function priceProposalOption(option, items, totalAmount) {
  const all = (items || []).reduce((sum, item) => sum + (Number(item?.amount) || 0), 0);
  const total = Number(totalAmount) || 0;
  if (!all || !total) return null;

  const amounts = resolveOptionAmounts(option, items);
  if (!amounts) return null;
  return Math.round((total * amounts.reduce((sum, n) => sum + n, 0)) / all);
}

/** Options with prices; options that can no longer be priced are dropped, and a lone option is not an option. */
export function withOptionPrices(options, items, totalAmount) {
  if (!Array.isArray(options)) return [];
  const priced = options
    .map((option) => ({ ...option, total: priceProposalOption(option, items, totalAmount) }))
    .filter((option) => option.total != null);
  return priced.length >= 2 ? priced : [];
}

export function isKnownOptionId(options, optionId) {
  return Array.isArray(options) && options.some((option) => option.id === optionId);
}
