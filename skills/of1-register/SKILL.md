---
name: of1-register
description: Register the current Edge Delivery Services site repo in the OF1 portal, or confirm it is already registered. Use as the first step of connecting a site to OF1.
---

# of1-register

## Setup

- Plugin root: `$CLAUDE_PLUGIN_ROOT`, else two directories above this SKILL.md. Run the CLI as `node <plugin root>/lib/cli.mjs <command>` from the site repo.
- Portal tools are MCP tools, referred to by name suffix. Use the `of1-portal-token` server's tools when `OF1_PORTAL_TOKEN` is set, else the `of1-portal` server's.
- Autonomous mode: `OF1_AUTONOMOUS` is set to anything other than `0` or `false`, or the argument `autonomous` is given. Never ask questions then.
- If a portal tool returns unauthorized: interactive, tell the person to sign in (`/mcp` in Claude Code) and stop; autonomous, stop with `OF1_PORTAL_TOKEN missing or invalid`.

## Steps

1. Run `node <plugin root>/lib/cli.mjs identity`. Take `site` (`<org>/<repo>`).
2. Call `describe_site` { site }.
   - `registered` true with access: report `skipped` (already registered) and stop.
   - `registered` true but the result says you have no role (`access.read` false): report that separately (registered, no access; ask the site admin) and stop. Not `skipped`.
3. Not registered:
   - **Autonomous:** stop with `"<org>/<repo> is not registered in the OF1 portal; the caller must register it first"`.
   - **Interactive:** ask for the site's public domain (empty = none). Normalise the answer to `https://<host>`: https scheme, no path, no trailing slash. Call `register_site` { site, domain? } (omit `domain` if none). Show the returned URL and tell the person to complete registration there.
4. Poll `get_registration` { id } with the id from `register_site`, every 20 seconds, up to 15 minutes. It returns `{ id, site, state, expiresAt }`:
   - `state` `done`: stop, report `done`.
   - `state` `expired`: report it; interactive: offer to call `register_site` again.
   - `pending` at timeout: report it is still pending.

## Report

One line: `skipped` (already registered), `no-access`, `done`, `expired`, `pending` (timed out) or the stop message.
