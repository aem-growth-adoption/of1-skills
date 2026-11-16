/*
 * Decision Block (reference implementation — copy to blocks/decision/decision.js)
 *
 * Renders the authored DEFAULT candidate (the first `candidate` row) exactly
 * like a Fragment block, so the page is correct when the OF1 edge proxy is not
 * in front of it (raw .aem.page/.aem.live, proxy fail-open, feature disabled).
 *
 * When the proxy runs, it rewrites this block into a standard `fragment` block
 * pointing at the chosen candidate before the page reaches the browser, so this
 * code never runs on a proxied page.
 */

import { loadFragment } from '../fragment/fragment.js';

function cellText(cell) {
  return (cell?.textContent || '').trim().toLowerCase();
}

/**
 * DA often stores links as absolute URLs. loadFragment only accepts a
 * site-relative path, so a same-origin absolute href becomes its pathname;
 * anything else is returned unchanged (and loadFragment will reject it).
 * @param {string} href
 * @returns {string}
 */
function toPath(href) {
  try {
    const url = new URL(href, window.location.href);
    return url.origin === window.location.origin ? url.pathname : href;
  } catch {
    return href;
  }
}

/**
 * @param {Element} block the decorated `.decision` block
 * @returns {string|null} the first candidate row's fragment path
 */
function defaultCandidate(block) {
  const row = [...block.children].find((r) => cellText(r.children[0]) === 'candidate');
  const cell = row?.children[1];
  if (!cell) return null;
  const link = cell.querySelector('a');
  const href = link ? link.getAttribute('href') : cell.textContent.trim();
  return href ? toPath(href) : null;
}

export default async function decorate(block) {
  const path = defaultCandidate(block);
  // Never show the authoring table (ids, hints, guards) to a reader.
  block.textContent = '';
  if (!path) return;

  // If the fragment fails to load the block stays empty (renders nothing).
  const fragment = await loadFragment(path);
  if (!fragment) return;

  const children = [...fragment.querySelectorAll(':scope > .section')]
    .flatMap((section) => [...section.childNodes]);
  block.replaceChildren(...children);
}
