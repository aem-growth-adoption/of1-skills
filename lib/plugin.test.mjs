import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PORTAL_MCP_URL } from "./target.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const TOOLS = ["describe_site", "register_site", "get_registration", "add_pages", "preview_changes", "get_pages_status", "set_area", "set_suggestions", "upsert_template", "set_feature", "get_setup", "get_settings"];

const skillsDir = join(root, "skills");
const skills = existsSync(skillsDir)
  ? readdirSync(skillsDir).filter((d) => existsSync(join(skillsDir, d, "SKILL.md"))).sort()
  : [];

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test("entrypoints.skills lists every skills/*/SKILL.md directory", () => {
  assert.deepEqual(json(".claude-plugin/plugin.json").entrypoints.skills, skills);
});

test("each SKILL.md is <= 200 lines with name = directory", () => {
  for (const s of skills) {
    const text = readFileSync(join(skillsDir, s, "SKILL.md"), "utf8");
    assert.ok(text.split("\n").length <= 200, `${s} too long`);
    assert.match(text, new RegExp(`^---\\n[\\s\\S]*?^name: ${s}\\s*$`, "m"));
  }
});

test("no Labs-specific terms in skills/, lib/, assets/", () => {
  const re = /\bLabs\b|Replica|OF1_DEMO_REPO|\/of1\/config\//;
  const self = join(root, "lib", "plugin.test.mjs");
  for (const d of ["skills", "lib", "assets"]) {
    for (const f of walk(join(root, d))) {
      if (f === self) continue;
      assert.doesNotMatch(readFileSync(f, "utf8"), re, f);
    }
  }
});

test("SKILL.md tool calls use only portal MCP tools", () => {
  for (const s of skills) {
    const text = readFileSync(join(skillsDir, s, "SKILL.md"), "utf8");
    for (const m of text.matchAll(/`([a-z]+_[a-z_]+)`? \{/g)) {
      assert.ok(TOOLS.includes(m[1]), `${s}: unknown tool ${m[1]}`);
    }
  }
});

test(".mcp.json servers point at PORTAL_MCP_URL", () => {
  const { mcpServers } = json(".mcp.json");
  assert.equal(mcpServers["of1-portal"].url, PORTAL_MCP_URL);
  assert.equal(mcpServers["of1-portal"].headers, undefined);
  assert.equal(mcpServers["of1-portal-token"].url, PORTAL_MCP_URL);
  assert.equal(mcpServers["of1-portal-token"].headers.Authorization, "Bearer ${OF1_PORTAL_TOKEN:-}");
});

test("plugin version and dependencies", () => {
  const p = json(".claude-plugin/plugin.json");
  assert.equal(p.version, "1.0.0-next");
  assert.deepEqual(p.dependencies, ["stardust@adobe-skills", "aem-edge-delivery-services@adobe-skills"]);
});
