import { decorateMain } from '../../scripts/scripts.js';
import { loadSections } from '../../scripts/aem.js';

async function decorateAndLoad(sectionHtml) {
  const tempMain = document.createElement('main');
  tempMain.innerHTML = `<div>${sectionHtml}</div>`;
  decorateMain(tempMain);
  await loadSections(tempMain);
  return Array.from(tempMain.querySelectorAll(':scope > div'));
}

function siteDomain() {
  const metaDomain = document.querySelector('meta[name="domain"]')?.content;
  if (metaDomain && metaDomain.includes('--')) return metaDomain;
  // <ref>--<repo>--<org>[--dev].<suffix>, optionally prefixed by `prev--`
  const label = window.location.hostname.split('.')[0].replace(/^prev--/, '').replace(/--dev$/, '');
  return label.split('--').length === 3 ? label : metaDomain || window.location.hostname;
}

export default async function decorate(block) {
  const domain = siteDomain();
  if (!document.querySelector('meta[name="domain"]')) {
    const meta = document.createElement('meta');
    meta.name = 'domain';
    meta.content = domain;
    document.head.appendChild(meta);
  }
  block.textContent = '';
  const { init } = await import(/* webpackIgnore: true */ `${window.location.origin}/sdk/of1-client.js`);
  await init(block, { domain }, { decorateAndLoad });
}
