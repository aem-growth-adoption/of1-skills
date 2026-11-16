---
name: of1-register
description: Register the current Edge Delivery Services site repo in the OF1 portal, or confirm it is already registered. Use as the first step of connecting a site to OF1.
---

# of1-register

## Setup

- Plugin root: `$CLAUDE_PLUGIN_ROOT`, else two directories above this SKILL.md. Run the CLI as `node <plugin root>/lib/cli.mjs <command>` from the site repo.
- Portal tools are MCP tools, referred to by name suffix. Use the `of1-portal-token` server's tools when `OF1_PORTAL_TOKEN` is set, else the `of1-portal` server's.
- Autonomous mode: `OF1_AUTONOMOUS` is set or the argument `autonomous` is given. Never ask questions then.
- If a portal tool returns unauthorized: interactive, tell the person to sign in (`/mcp` in Claude Code) and stop; autonomous, stop with `OF1_PORTAL_TOKEN missing or invalid`.

## Steps

1. Run `node <plugin root>/lib/cli.mjs identity`. Take `site` (`<org>/<repo>`).
2. Call `describe_site` { site }. If it reports the site as `registered`, report `skipped` (already registered) and stop.
3. Not registered:
   - **Autonomous:** stop with `"<org>/<repo> is not registered in the OF1 portal; the caller must register it first"`.
   - **Interactive:** ask for the site's public domain (default none). Call `register_site` { site, domain? } (omit `domain` if none). Show the returned URL to the person and tell them to complete registration there.
4. Poll `get_registration` { id } with the id from `register_site`, every 20 seconds, for up to 15 minutes. Stop when it reports registered; report `done`. On timeout, report that registration is still pending and what the person must finish.

## Report

One line: `skipped` (already registered), `done`, `pending` (timed out) or the stop message.
