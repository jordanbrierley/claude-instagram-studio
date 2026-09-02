import path from "node:path";

export const DEFAULT_LABEL = "com.jordanbrierley.instagram-studio";
const DEFAULT_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";

const esc = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderPlist({
  label = DEFAULT_LABEL,
  nodePath,
  cliPath,
  repoDir,
  slots,
  logDir,
  startInterval = 1800,
  pathEnv = DEFAULT_PATH,
}) {
  const calendar = slots.map((slot) => {
    const [hour, minute] = slot.split(":").map(Number);
    return `    <dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${esc(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(nodePath)}</string>
    <string>${esc(cliPath)}</string>
    <string>publish</string>
    <string>--repo</string>
    <string>${esc(repoDir)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${esc(pathEnv)}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <array>
${calendar}
  </array>
  <key>StartInterval</key>
  <integer>${startInterval}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${esc(path.join(logDir, "out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${esc(path.join(logDir, "err.log"))}</string>
</dict>
</plist>
`;
}
