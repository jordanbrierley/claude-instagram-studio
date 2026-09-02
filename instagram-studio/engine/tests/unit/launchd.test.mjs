import test from "node:test";
import assert from "node:assert/strict";
import { renderPlist, DEFAULT_LABEL } from "../../lib/launchd.mjs";

const base = {
  nodePath: "/opt/homebrew/bin/node",
  cliPath: "/Users/x/.claude/plugins/data/instagram-studio/engine/ig.mjs",
  repoDir: "/Users/x/Sites/my repo",
  slots: ["08:30", "12:30", "17:30"],
  logDir: "/Users/x/Library/Logs/instagram-studio",
};

test("the plist runs ig publish for the repo with an absolute node path", () => {
  const xml = renderPlist(base);
  assert.match(xml, /<key>Label<\/key>\s*<string>com\.jordanbrierley\.instagram-studio<\/string>/);
  assert.match(xml, /<string>\/opt\/homebrew\/bin\/node<\/string>/);
  assert.match(xml, /<string>publish<\/string>/);
  assert.match(xml, /<string>--repo<\/string>/);
  assert.match(xml, /<string>\/Users\/x\/Sites\/my repo<\/string>/);
});

test("one StartCalendarInterval dict per slot, plus the catch-up interval and RunAtLoad", () => {
  const xml = renderPlist(base);
  const dicts = xml.match(/<key>Hour<\/key>/g) ?? [];
  assert.equal(dicts.length, 3);
  assert.match(xml, /<key>Hour<\/key><integer>8<\/integer><key>Minute<\/key><integer>30<\/integer>/);
  assert.match(xml, /<key>Hour<\/key><integer>17<\/integer><key>Minute<\/key><integer>30<\/integer>/);
  assert.match(xml, /<key>StartInterval<\/key>\s*<integer>1800<\/integer>/);
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
});

test("stdout and stderr go to absolute log paths and PATH is set for ffprobe", () => {
  const xml = renderPlist(base);
  assert.match(xml, /<key>StandardOutPath<\/key>\s*<string>\/Users\/x\/Library\/Logs\/instagram-studio\/out\.log<\/string>/);
  assert.match(xml, /<key>StandardErrorPath<\/key>\s*<string>\/Users\/x\/Library\/Logs\/instagram-studio\/err\.log<\/string>/);
  assert.match(xml, /\/opt\/homebrew\/bin/);
  assert.equal(xml.includes("~"), false); // launchd does not expand a tilde
});

test("a caller-supplied node path and label are rendered verbatim", () => {
  const xml = renderPlist({ ...base, nodePath: "/Users/x/.nvm/versions/node/v22.18.0/bin/node", label: "com.example.ig-test" });
  assert.match(xml, /<string>\/Users\/x\/\.nvm\/versions\/node\/v22\.18\.0\/bin\/node<\/string>/);
  assert.match(xml, /<key>Label<\/key>\s*<string>com\.example\.ig-test<\/string>/);
  assert.equal(xml.includes(DEFAULT_LABEL), false);
});

test("XML special characters in a path are escaped", () => {
  const xml = renderPlist({ ...base, repoDir: "/Users/x/a&b" });
  assert.match(xml, /<string>\/Users\/x\/a&amp;b<\/string>/);
});
