// Shared helpers for the dev scripts: who is listening on a port, and is it one of our own dev processes?
const { execFileSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const win = process.platform === "win32";

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 });
  } catch {
    return "";
  }
}

/** PIDs listening on a TCP port. */
function listeners(port) {
  if (win) {
    const out = run("netstat", ["-ano", "-p", "tcp"]);
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (m && Number(m[1]) === port) pids.add(Number(m[2]));
    }
    return [...pids];
  }
  return run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).split(/\s+/).filter(Boolean).map(Number);
}

function commandLine(pid) {
  if (win) {
    return run("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`]).trim();
  }
  return run("ps", ["-o", "command=", "-p", String(pid)]).trim();
}

/** Only ever treat a process as ours if it plainly belongs to this project's dev servers. */
function isOurs(cmd) {
  const norm = (s) => s.toLowerCase().replace(/\\/g, "/");
  const c = norm(cmd);
  return c.includes(norm(ROOT)) || /hardhat/.test(c) || /next[\\/]dist/.test(c) || /next dev/.test(c);
}

function kill(pid) {
  if (win) run("taskkill", ["/PID", String(pid), "/F", "/T"]);
  else run("kill", ["-9", String(pid)]);
}

module.exports = { ROOT, listeners, commandLine, isOurs, kill };
