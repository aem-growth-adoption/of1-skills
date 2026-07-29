// fill-template.jsh — Fill an OF1 template HTML file with slot values from a JSON file.
//
// Usage:
//   fill-template.jsh <template.html> <values.json> <out.html>
//
// Slot conventions:
//   text  : element has data-slot="key"       — sets innerHTML to value
//   image : <img data-slot="key">             — sets src/alt
//   link  : <a data-slot="key">               — sets href + label
//   list  : element has data-slot-list="key"  — replaces innerHTML with <li> per item

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;');
}

function fillSlot(html, key, value) {
  if (value === null || value === undefined) return html;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(<([a-z][\\w-]*)([^>]*?)\\sdata-slot="${escapedKey}"([^>]*)>)([\\s\\S]*?)(<\\/\\2>)`,
    'gi'
  );

  return html.replace(pattern, (match, openTag, tagName, beforeAttrs, afterAttrs, inner, closeTag) => {
    const tag = tagName.toLowerCase();
    if (tag === 'img') return match;

    if (tag === 'a') {
      let href, label;
      if (typeof value === 'object' && value !== null) {
        href = value.href || '#';
        label = value.label || '';
      } else {
        href = '#';
        label = String(value);
      }
      let newOpen = openTag.replace(/\shref="[^"]*"/, '');
      newOpen = newOpen.replace('<a', `<a href="${escapeAttr(href)}"`);
      return `${newOpen}${escapeHtml(String(label))}${closeTag}`;
    }

    // Text slot
    let inner2;
    if (typeof value === 'object' && value !== null && value.html) {
      inner2 = value.html;
    } else {
      inner2 = escapeHtml(String(value));
    }
    return `${openTag}${inner2}${closeTag}`;
  });
}

function fillImgSlot(html, key, value) {
  if (value === null || value === undefined) return html;
  let src, alt;
  if (typeof value === 'object' && value !== null) {
    src = value.src || '';
    alt = value.alt || '';
  } else {
    src = String(value);
    alt = '';
  }
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<img([^>]*?)\\sdata-slot="${escapedKey}"([^>]*?)>`,
    'gi'
  );

  return html.replace(pattern, (match, before, after) => {
    const stripped = (before + after).replace(/\s(src|alt)="[^"]*"/g, '');
    return `<img${stripped} src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" data-slot="${key}">`;
  });
}

function fillListSlot(html, key, items) {
  if (!Array.isArray(items) || items.length === 0) return html;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(<([a-z][\\w-]*)([^>]*?)\\sdata-slot-list="${escapedKey}"([^>]*)>)([\\s\\S]*?)(<\\/\\2>)`,
    'gi'
  );
  const liHtml = items.map(item => `<li>${escapeHtml(String(item))}</li>`).join('');

  return html.replace(pattern, (match, openTag, tagName, b, a, inner, closeTag) => {
    return `${openTag}${liHtml}${closeTag}`;
  });
}

async function main() {
  if (process.argv.length < 4) {
    console.error('usage: fill-template.jsh <template.html> <values.json> <out.html>');
    process.exit(2);
  }

  const templatePath = process.argv[1];
  const valuesPath = process.argv[2];
  const outPath = process.argv[3];

  const template = await fs.readFile(templatePath);
  const values = JSON.parse(await fs.readFile(valuesPath));

  // Count items for grid
  let itemCount = 0;
  for (const k of ['item-1', 'item-2', 'item-3', 'item-4', 'item-5', 'item-6']) {
    if (values[`${k}.title`] || values[`${k}.body`]) itemCount++;
  }

  let out = template;

  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith('_')) continue;
    if (Array.isArray(value)) {
      out = fillListSlot(out, key, value);
    } else if (typeof value === 'object' && value !== null && 'src' in value) {
      out = fillImgSlot(out, key, value);
    } else {
      out = fillImgSlot(out, key, value);
      out = fillSlot(out, key, value);
    }
  }

  // Strip unfilled image slots
  out = out.replace(/<img[^>]*\sdata-slot="[^"]+"[^>]*>/g, (match) => {
    if (match.includes('src="') && !match.includes('src=""')) return match;
    return '';
  });

  // Hide unused cards
  out = out.replace(/<article([^>]*?\sdata-card="(\d+)"[^>]*)>/g, (match, attrs, idx) => {
    const keyMatch = attrs.match(/\sdata-card-key="([^"]+)"/);
    const probeKey = keyMatch ? keyMatch[1] : `item-${idx}.title`;
    const fallbackKey = keyMatch ? null : `item-${idx}.body`;
    const present = values[probeKey] !== undefined && values[probeKey] !== null ||
                    (fallbackKey && values[fallbackKey] !== undefined && values[fallbackKey] !== null);
    if (present) return match;
    if (attrs.includes(' hidden')) return match;
    return `<article${attrs} hidden>`;
  });

  // Mark grid with item count
  out = out.replace(
    '<div class="of1-cmp-grid" data-grid-items>',
    `<div class="of1-cmp-grid" data-grid-items data-item-count="${itemCount}">`
  );

  // Wrap in standalone page
  const stylesheet = (values._meta && values._meta.stylesheet) || '/styles/of1-template-base.css';
  const title = values['hero.title'] || 'Template Preview';

  const standalone = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(String(title))}</title>
  <link rel="stylesheet" href="${escapeAttr(stylesheet)}">
</head>
<body>
${out}
</body>
</html>
`;

  await fs.writeFile(outPath, standalone);
  console.log(`wrote ${outPath} (${standalone.length} bytes, ${itemCount} items)`);
}

await main();
