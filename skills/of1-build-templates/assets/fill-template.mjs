#!/usr/bin/env node
// Fill an OF1 template HTML file with slot values from a JSON file.
//
// Usage:
//     node fill-template.mjs templates/of1-comparison.html sample.json drafts/out.html
//
// Slot conventions (matching templates/of1-*.metadata.json):
//   text  : element has data-slot="key"           — sets innerHTML to value
//   image : <img data-slot="key">                 — sets src/alt
//   link  : <a data-slot="key">                   — sets href + label
//   list  : element has data-slot-list="key"      — replaces innerHTML with <li> per item

import fs from 'node:fs';
import path from 'node:path';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeAttr(s) {
  return String(s ?? '').replace(/"/g, '&quot;');
}

function htmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Allowlist href schemes. Values are LLM-authored JSON, so reject anything that
// isn't http(s)/mailto/tel, a relative path, or an anchor (e.g. javascript:).
function safeHref(href) {
  const h = String(href ?? '#').trim();
  if (h === '') return '#';
  if (/^(https?:|mailto:|tel:)/i.test(h)) return h; // allowed absolute schemes
  if (/^[/#?]/.test(h)) return h; // root-relative, anchor, or query
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) {
    console.error(`WARN: href '${h}' uses a disallowed scheme — replaced with '#'.`);
    return '#';
  }
  return h; // bare relative path (e.g. "product.html")
}

function fillSlot(html, key, value, matched) {
  if (value === null || value === undefined) return html;
  const escapedKey = escapeRegex(key);
  const pattern = new RegExp(
    `(<([a-z][\\w-]*)([^>]*?)\\sdata-slot=["']${escapedKey}["']([^>]*)>)([\\s\\S]*?)(<\\/\\2>)`,
    'gi',
  );

  return html.replace(pattern, (...args) => {
    const [full, openTag, tagName, , , body, closeTag] = args;
    const tag = tagName.toLowerCase();

    if (tag === 'img') {
      return full;
    }

    // Finding 54: the non-greedy body + \2 backreference matches the FIRST
    // closing tag, so a same-tag child (<div>…<div></div></div>) corrupts the
    // output. Detect the hazard and refuse rather than emit broken HTML.
    if (new RegExp(`<${escapeRegex(tag)}[\\s>]`, 'i').test(body)) {
      console.error(`WARN: slot '${key}' wraps a nested <${tag}> — cannot fill safely with regex; left untouched.`);
      return full;
    }

    if (matched) matched.add(key);

    if (tag === 'a') {
      let href;
      let label;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        href = value.href ?? '#';
        label = value.label ?? '';
      } else {
        href = '#';
        label = String(value);
      }
      let newOpen = openTag.replace(/\shref=(["']).*?\1/, '');
      newOpen = newOpen.replace('<a', `<a href="${escapeAttr(safeHref(href))}"`);
      return `${newOpen}${htmlEscape(String(label))}${closeTag}`;
    }

    // Text slot
    let inner2;
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && 'html' in value) {
      inner2 = value.html;
    } else {
      inner2 = htmlEscape(String(value));
    }
    return `${openTag}${inner2}${closeTag}`;
  });
}

function fillImgSlot(html, key, value, matched) {
  if (value === null || value === undefined) return html;
  let src;
  let alt;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    src = value.src ?? '';
    alt = value.alt ?? '';
  } else {
    src = String(value);
    alt = '';
  }
  const escapedKey = escapeRegex(key);
  const pattern = new RegExp(`<img([^>]*?)\\sdata-slot=["']${escapedKey}["']([^>]*?)>`, 'gi');

  return html.replace(pattern, (...args) => {
    const [, before, after] = args;
    if (matched) matched.add(key);
    const stripped = (before + after).replace(/\s(src|alt)=(["']).*?\2/g, '');
    return `<img${stripped} src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" data-slot="${key}">`;
  });
}

function fillListSlot(html, key, items, matched) {
  if (!Array.isArray(items) || items.length === 0) return html;
  const escapedKey = escapeRegex(key);
  const pattern = new RegExp(
    `(<([a-z][\\w-]*)([^>]*?)\\sdata-slot-list=["']${escapedKey}["']([^>]*)>)([\\s\\S]*?)(<\\/\\2>)`,
    'gi',
  );
  const liHtml = items.map((item) => `<li>${htmlEscape(String(item))}</li>`).join('');

  return html.replace(pattern, (...args) => {
    const openTag = args[1];
    const closeTag = args[6];
    if (matched) matched.add(key);
    return `${openTag}${liHtml}${closeTag}`;
  });
}

function main(argv) {
  if (argv.length !== 5) {
    console.error('usage: fill-template.mjs <template.html> <values.json> <out.html>');
    return 2;
  }

  const templatePath = argv[2];
  const valuesPath = argv[3];
  const outPath = argv[4];

  const template = fs.readFileSync(templatePath, 'utf8');
  const values = JSON.parse(fs.readFileSync(valuesPath, 'utf8'));

  // Count items for grid (item-1..item-9 — the full slot-key range, per the
  // metadata convention; used only for the summary log line).
  const itemKeys = ['item-1', 'item-2', 'item-3', 'item-4', 'item-5', 'item-6', 'item-7', 'item-8', 'item-9'];
  const itemCount = itemKeys.filter(
    (k) => values[`${k}.title`] || values[`${k}.body`],
  ).length;

  let out = template;
  const matched = new Set();

  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith('_')) continue;
    if (Array.isArray(value)) {
      out = fillListSlot(out, key, value, matched);
    } else if (value !== null && typeof value === 'object' && 'src' in value) {
      out = fillImgSlot(out, key, value, matched);
    } else {
      out = fillImgSlot(out, key, value, matched);
      out = fillSlot(out, key, value, matched);
    }
  }

  // Finding 47/52/54: warn on any value that matched zero slots — the single
  // signal that catches quote mismatches, un-hidden cards, and refused slots.
  const dataKeys = Object.keys(values).filter((k) => !k.startsWith('_'));
  const unmatched = dataKeys.filter((k) => !matched.has(k));
  for (const k of unmatched) {
    console.error(`WARN: no slot found for key '${k}' — value dropped.`);
  }

  // Strip unfilled image slots
  out = out.replace(/<img[^>]*\sdata-slot="[^"]+"[^>]*>/g, (m) =>
    m.includes('src="') && !m.includes('src=""') ? m : '',
  );

  // Hide unused cards. Cards carry data-card on <article>, <li>, <tr>, <div>,
  // or <section> (finding 52 — <article>-only left <tr>/<li> empty rows visible).
  out = out.replace(/<(article|li|tr|div|section)([^>]*?\sdata-card="(\d+)"[^>]*)>/g, (m, tag, attrs, idx) => {
    const keyMatch = attrs.match(/\sdata-card-key="([^"]+)"/);
    const probeKey = keyMatch ? keyMatch[1] : `item-${idx}.title`;
    const fallbackKey = keyMatch ? null : `item-${idx}.body`;
    const present =
      values[probeKey] !== null && values[probeKey] !== undefined ||
      (fallbackKey && values[fallbackKey] !== null && values[fallbackKey] !== undefined);
    if (present) return m;
    if (attrs.includes(' hidden')) return m;
    return `<${tag}${attrs} hidden>`;
  });

  // Wrap in standalone page
  const stylesheet = values._meta?.stylesheet ?? '/styles/of1-template-base.css';
  const title = values['hero.title'] ?? 'Template Preview';

  const standalone = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(String(title))}</title>
  <link rel="stylesheet" href="${escapeAttr(stylesheet)}">
</head>
<body>
${out}
</body>
</html>
`;

  fs.mkdirSync(path.dirname(outPath) || '.', { recursive: true });
  fs.writeFileSync(outPath, standalone);

  console.log(
    `wrote ${outPath} (${standalone.length} bytes, ${matched.size}/${dataKeys.length} slots filled, ${itemCount} grid items)`,
  );
  return 0;
}

process.exit(main(process.argv));
