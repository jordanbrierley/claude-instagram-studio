#!/usr/bin/env node
// Validates plugin manifests parse and every path they reference exists.
// Run: node scripts/validate.mjs   (exit 0 = OK)
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg) => { console.error(`validate: ${msg}`); process.exit(1); };
const readJson = (rel) => {
  const p = path.join(root, rel);
  if (!existsSync(p)) fail(`${rel} missing`);
  try { return JSON.parse(readFileSync(p, "utf8")); } catch (e) { fail(`${rel} invalid JSON: ${e.message}`); }
};

const marketplace = readJson(".claude-plugin/marketplace.json");
if (marketplace.name !== "jordanbrierley-instagram") fail("marketplace name changed unexpectedly");
for (const plugin of marketplace.plugins) {
  if (!existsSync(path.join(root, plugin.source))) fail(`plugin source ${plugin.source} missing`);
}

const pluginDir = "instagram-studio";
const manifest = readJson(`${pluginDir}/.claude-plugin/plugin.json`);
if (manifest.name !== "instagram-studio") fail("plugin name changed unexpectedly");
if ("version" in manifest) fail("plugin.json must not pin a version during development");

const hooksRel = `${pluginDir}/hooks/hooks.json`;
if (existsSync(path.join(root, hooksRel))) {
  const hooks = readJson(hooksRel);
  for (const group of hooks.hooks?.SessionStart ?? []) {
    for (const hook of group.hooks ?? []) {
      const match = /\$\{CLAUDE_PLUGIN_ROOT\}\/?"?([^"\s]+)/.exec(hook.command ?? "");
      if (match && !existsSync(path.join(root, pluginDir, match[1]))) fail(`hook target ${match[1]} missing`);
    }
  }
}

// Every skill has frontmatter with a name that matches its directory.
const skillsDir = path.join(root, pluginDir, "skills");
if (existsSync(skillsDir)) {
  for (const name of readdirSync(skillsDir)) {
    const skill = path.join(skillsDir, name, "SKILL.md");
    if (!existsSync(skill)) fail(`skills/${name}/SKILL.md missing`);
    const text = readFileSync(skill, "utf8");
    if (!text.startsWith("---\n")) fail(`skills/${name}/SKILL.md has no frontmatter`);
    if (!new RegExp(`^name:\\s*${name}\\s*$`, "m").test(text)) fail(`skills/${name}/SKILL.md name does not match its directory`);
  }
}

// House style: no em dashes in the plugin tree, in scripts/, or in the README.
// Dot directories are walked too, so .claude-plugin/plugin.json is covered, and
// scripts/ means this file checks itself. The character is written as an escape so
// the check can never trip on its own source.
const EM_DASH = "\u2014";
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  if (d.name === "node_modules") return [];
  const p = path.join(dir, d.name);
  return d.isDirectory() ? walk(p) : [p];
});
const styleRoots = [path.join(root, pluginDir), path.join(root, "scripts")];
const styleFiles = [...styleRoots.filter((dir) => existsSync(dir)).flatMap(walk), path.join(root, "README.md")];
for (const file of styleFiles) {
  if (!existsSync(file)) continue; // README.md arrives in Task 13
  if (!/\.(mjs|md|json)$/.test(file)) continue;
  if (readFileSync(file, "utf8").includes(EM_DASH)) fail(`${path.relative(root, file)} contains an em dash`);
}

console.log("validate: OK");
