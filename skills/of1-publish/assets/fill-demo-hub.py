#!/usr/bin/env python3
"""
Fill the demo-hub.html template with data from the OF1 demo pipeline.

Usage (always cd into repo first):
    cd /workspace/of1-demo-orchestrator && python3 /path/to/fill-demo-hub.py . www.adobe.com

Args:
    repo-dir: Path to repo root (use "." when already cd'd in)
    domain:   The demo domain name

Reads:
    /shared/of1-demo-orchestrator/repo-config.json
    /shared/of1-demo-orchestrator/step-3-output.md (first paragraph of narrative)
    of1/config/{products,personas,suggestions,templates}.json
    stardust/current/assets/logo.svg (optional)
    DA content pages (scans /mnt/da/{branch}/)

Writes: deliverables/index.html
"""

import json
import os
import sys
from html import escape
from pathlib import Path
from datetime import date

def load_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def load_text(path):
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError:
        return ''

def count_templates(repo_dir):
    """Count of1-* template HTML files."""
    tpl_dir = Path(repo_dir) / 'templates'
    if not tpl_dir.exists():
        return 0
    return len([f for f in tpl_dir.glob('of1-*.html')])


def render_audit(state_dir):
    """Render pipeline-audit.json as an HTML section for the demo hub."""
    audit = load_json(f'{state_dir}/pipeline-audit.json')
    if not audit or not audit.get('steps'):
        return ''

    total_tokens = audit.get('totalTokens') or 0
    total_duration = audit.get('totalDurationMs') or 0
    total_mins = total_duration / 60000
    step_count = audit.get('stepCount', len(audit['steps']))

    # Skill version
    skill_version = audit.get('skillVersion', 'unknown')
    skill_branch = audit.get('skillBranch', 'unknown')

    # Summary stats
    html = '<h2>Pipeline Audit</h2>\n'
    html += f'<p style="font-size:11px;color:var(--dim);margin-bottom:12px;">Skills: {escape(skill_branch)}@{escape(skill_version)}</p>\n'
    html += '<div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:16px;">\n'
    html += f'  <div style="font-size:12px;color:var(--dim);">Total tokens<br><span style="font-size:20px;color:var(--fg);">{total_tokens:,}</span></div>\n'
    html += f'  <div style="font-size:12px;color:var(--dim);">Wall clock<br><span style="font-size:20px;color:var(--fg);">{total_mins:.1f} min</span></div>\n'
    html += f'  <div style="font-size:12px;color:var(--dim);">Dispatches<br><span style="font-size:20px;color:var(--fg);">{step_count}</span></div>\n'
    html += '</div>\n'

    # Per-step table
    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;margin-bottom:24px;">\n'
    html += '<tr style="text-align:left;color:var(--dim);border-bottom:1px solid var(--border);">'
    html += '<th style="padding:6px 8px;">Step</th><th>Name</th><th>Model</th>'
    html += '<th style="text-align:right;">Tokens</th><th style="text-align:right;">Duration</th>'
    html += '<th>Status</th></tr>\n'

    for s in audit['steps']:
        dur_s = (s.get('durationMs') or 0) / 1000
        tokens = s.get('totalTokens') or 0
        status = s.get('status', '?')
        status_color = 'var(--accent)' if status == 'done' else ('var(--orange)' if status == 'failed' else 'var(--dim)')
        retries = s.get('retries', 0)
        retry_badge = f' <span style="color:var(--orange);">↻{retries}</span>' if retries > 0 else ''

        html += f'<tr style="border-bottom:1px solid var(--border);">'
        html += f'<td style="padding:6px 8px;">{s.get("step", "?")}</td>'
        html += f'<td>{escape(s.get("name", ""))}</td>'
        html += f'<td>{escape(s.get("model", ""))}</td>'
        html += f'<td style="text-align:right;">{tokens:,}</td>'
        html += f'<td style="text-align:right;">{dur_s:.0f}s</td>'
        html += f'<td style="color:{status_color};">{status}{retry_badge}</td>'
        html += '</tr>\n'

    html += '</table>\n'

    # Improvements
    improvements = audit.get('improvements', [])
    if improvements:
        html += '<h2>Improvements</h2>\n'
        html += '<div style="display:flex;flex-direction:column;gap:12px;">\n'
        for imp in improvements:
            html += '<div style="padding:12px 16px;border:1px solid var(--border);border-radius:6px;font-size:12px;">\n'
            html += f'  <div style="color:var(--orange);margin-bottom:4px;">Step {imp.get("step", "?")} — {escape(imp.get("issue", ""))}</div>\n'
            html += f'  <div style="color:var(--dim);">{escape(imp.get("suggestion", ""))}</div>\n'
            html += '</div>\n'
        html += '</div>\n'

    return html

def extract_narrative(step3_output):
    """Extract the narrative paragraph from discovery output."""
    lines = step3_output.split('\n')
    in_narrative = False
    narrative_lines = []
    for line in lines:
        if '**Persona:**' in line or '**Journey:**' in line:
            in_narrative = True
            narrative_lines.append(line.replace('**Persona:**', '').replace('**Journey:**', '').strip())
        elif in_narrative and line.strip() == '':
            break
        elif in_narrative:
            narrative_lines.append(line.strip())
    return ' '.join(narrative_lines) if narrative_lines else 'Demo narrative not available.'

def extract_focus(step3_output):
    """Extract the demo focus from discovery."""
    lines = step3_output.split('\n')
    for line in lines:
        if '## Demo Focus' in line:
            idx = lines.index(line)
            if idx + 1 < len(lines):
                return lines[idx + 1].strip()
    return 'AI-Powered Experience'

def get_logo_svg(repo_dir):
    """Get brand logo SVG if available."""
    logo_path = Path(repo_dir) / 'stardust' / 'current' / 'assets' / 'logo.svg'
    if logo_path.exists():
        svg = logo_path.read_text().strip()
        # Add height constraint
        if 'height=' not in svg:
            svg = svg.replace('<svg', '<svg height="28"', 1)
        return svg
    return ''

def find_eds_pages(repo_dir, branch, owner, repo):
    """Find DA content pages for this branch.
    
    Reads from /tmp/da-pages.txt which the calling shell script must create:
        ls /mnt/da/{branch}/*.html > /tmp/da-pages.txt 2>/dev/null
    
    Falls back to scanning the flat content/ directory (stardust:deploy's
    output shape) for page files.
    """
    preview_base = f'https://{branch}--{repo}--{owner}.aem.page'
    pages = []
    
    # Try pre-generated page list
    pages_file = Path('/tmp/da-pages.txt')
    if pages_file.exists():
        for line in pages_file.read_text().strip().split('\n'):
            if not line.strip():
                continue
            name = Path(line.strip()).stem
            if name in ('nav', 'footer'):
                continue
            label = name.replace('-', ' ').replace('prototype ', '').title()
            pages.append({'url': f'{preview_base}/{name}', 'label': label})
    
    # Fallback: check DA content files committed to the repo
    if not pages:
        content_dir = Path(repo_dir) / 'content'
        if content_dir.exists():
            for page_file in sorted(content_dir.glob('*.html')):
                slug = page_file.stem
                if slug in ('nav', 'footer'):
                    continue
                label = slug.replace('-', ' ').replace('prototype ', '').title()
                pages.append({'url': f'{preview_base}/{slug}', 'label': label})
    
    return pages

def render_eds_pages(pages):
    """Render EDS page link pills."""
    html = ''
    for p in pages:
        html += f'  <a href="{p["url"]}"><span class="badge badge--green">AEM Preview</span> {escape(p["label"])}</a>\n'
    return html or '  <span style="color:var(--dim)">No pages published yet</span>'

def render_prototypes(repo_dir, preview_base):
    """Render prototype link pills."""
    html = ''
    proto_dir = Path(repo_dir) / 'stardust' / 'current' / 'prototypes'
    deliv_dir = Path(repo_dir) / 'deliverables'
    
    # Check stardust prototypes
    if proto_dir.exists():
        for f in sorted(proto_dir.glob('*.html')):
            label = f.stem.replace('-', ' ').replace('prototype ', '').title()
            html += f'  <a href="{preview_base}/deliverables/prototype-{f.stem}.html"><span class="badge badge--orange">Standalone</span> {escape(label)}</a>\n'
    
    # Check deliverables for prototype-* files
    if not html and deliv_dir.exists():
        for f in sorted(deliv_dir.glob('prototype-*.html')):
            label = f.stem.replace('prototype-', '').replace('-', ' ').title()
            html += f'  <a href="{preview_base}/deliverables/{f.name}"><span class="badge badge--orange">Standalone</span> {escape(label)}</a>\n'
    
    return html or '  <span style="color:var(--dim)">No prototypes yet</span>'

def render_config_summary(products, personas, suggestions, templates_json):
    """Render config summary items."""
    items = []
    
    # Products
    if products:
        product_names = [p.get('name', '?') for p in products[:4]]
        items.append(('Products', ', '.join(product_names) + ('...' if len(products) > 4 else '')))
    
    # Personas
    if personas:
        persona_names = [p.get('name', '?') for p in personas[:3]]
        items.append(('Personas', ', '.join(persona_names) + ('...' if len(personas) > 3 else '')))
    
    # Suggestions
    if isinstance(suggestions, dict):
        chips = suggestions.get('suggestions', [])
        items.append(('Suggestion Chips', str(len(chips))))
        if suggestions.get('title'):
            items.append(('Search Title', suggestions['title']))
    
    # Templates
    if isinstance(templates_json, dict):
        intents = templates_json.get('intents', [])
        if intents:
            items.append(('Intents', ', '.join(intents)))
    
    html = ''
    for label, value in items:
        html += f'''    <div class="config-item">
      <div class="config-label">{escape(label)}</div>
      <div class="config-value">{escape(str(value))}</div>
    </div>\n'''
    return html

def main():
    if len(sys.argv) < 3:
        print("Usage: fill-demo-hub.py <repo-dir> <domain>")
        sys.exit(1)
    
    repo_dir = sys.argv[1]
    domain = sys.argv[2]
    
    # Load repo config — REQUIRED. Do NOT silently fall back; a wrong branch
    # produces broken preview URLs across the entire hub (e.g. wknd vs wknd-cloud).
    state_dir = os.environ.get('OF1_STATE_DIR', '/shared/of1-demo-orchestrator')
    repo_config_path = f'{state_dir}/repo-config.json'
    repo_config = load_json(repo_config_path)
    if not repo_config:
        print(f"ERROR: {repo_config_path} is missing or empty. "
              f"Run of1-check-dependencies first to write it.", file=sys.stderr)
        sys.exit(1)
    missing = [k for k in ('owner', 'repo', 'branch') if not repo_config.get(k)]
    if missing:
        print(f"ERROR: {repo_config_path} is missing required field(s): {missing}",
              file=sys.stderr)
        sys.exit(1)
    owner = repo_config['owner']
    repo = repo_config['repo']
    branch = repo_config['branch']

    preview_base = f'https://{branch}--{repo}--{owner}.aem.page'
    tenant_id = f'{branch}--{repo}--{owner}'
    
    # Load data
    products = load_json(f'{repo_dir}/of1/config/products.json')
    if isinstance(products, dict):
        products = products.get('products', [])
    personas = load_json(f'{repo_dir}/of1/config/personas.json')
    if isinstance(personas, dict):
        personas = personas.get('personas', [])
    suggestions = load_json(f'{repo_dir}/of1/config/suggestions.json')
    templates_json = load_json(f'{repo_dir}/of1/config/templates.json')
    
    step3 = load_text(f'{state_dir}/step-3-output.md')
    narrative = extract_narrative(step3)
    focus = extract_focus(step3)
    
    num_templates = count_templates(repo_dir)
    num_suggestions = len(suggestions.get('suggestions', [])) if isinstance(suggestions, dict) else 0
    
    # EDS pages
    eds_pages = find_eds_pages(repo_dir, branch, owner, repo)
    
    # Logo
    logo_svg = get_logo_svg(repo_dir)
    
    # URLs
    of1_url = f'{preview_base}/of1'
    gallery_url = f'{preview_base}/gallery/index.html'
    
    # Load template
    template_path = Path(__file__).parent / 'demo-hub.html'
    template = template_path.read_text()
    
    # Render prototypes
    prototypes_html = render_prototypes(repo_dir, preview_base)
    
    # Fill template
    html = template
    html = html.replace('{{DOMAIN}}', escape(domain))
    html = html.replace('{{NUM_PRODUCTS}}', str(len(products)))
    html = html.replace('{{OF1_URL}}', of1_url)
    html = html.replace('{{GALLERY_URL}}', gallery_url)
    html = html.replace('{{PREVIEW_BASE}}', preview_base)
    html = html.replace('{{PROTOTYPES}}', prototypes_html)
    html = html.replace('{{EDS_PAGES}}', render_eds_pages(eds_pages))
    html = html.replace('{{OWNER}}', owner)
    html = html.replace('{{REPO}}', repo)
    html = html.replace('{{BRANCH}}', branch)
    html = html.replace('{{DATE}}', date.today().strftime('%B %d, %Y'))
    html = html.replace('{{PIPELINE_AUDIT}}', render_audit(state_dir))
    
    # Write output
    out_dir = Path(repo_dir) / 'deliverables'
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / 'index.html'
    out_path.write_text(html)
    
    print(f'✓ Demo hub written to {out_path}')
    print(f'  {len(products)} products, {num_templates} templates, {len(personas)} personas, {num_suggestions} suggestions, {len(eds_pages)} EDS pages')

if __name__ == '__main__':
    main()
