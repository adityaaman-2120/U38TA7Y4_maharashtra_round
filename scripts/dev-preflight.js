// Runs before `npm run dev`. Starting a second copy on top of a stale one is what makes the app load forever, so check first
// and say exactly what to do, instead of failing halfway with half the stack started.
const fs = require("fs");
const path = require("path");
const { ROOT, listeners, commandLine, isOurs } = require("./ports");

const problems = [];
for (const [port, what] of [[3000, "the web app (next dev)"], [8545, "the local blockchain (Hardhat node)"]]) {
  for (const pid of listeners(port)) {
    const cmd = commandLine(pid);
    problems.push({ port, what, pid, ours: isOurs(cmd), cmd });
  }
}

if (problems.length) {
  console.error("\nCannot start: something is already running on a port Heirloom needs.\n");
  for (const p of problems) {
    console.error(`  port ${p.port} (${p.what}) is in use by PID ${p.pid}${p.ours ? ", an older Heirloom dev server" : ", which is not a Heirloom dev server"}`);
  }
  if (problems.every((p) => p.ours)) {
    console.error("\nStop the old one and start fresh with:\n\n    npm run dev:clean\n");
  } else {
    console.error("\nClose whatever is using those ports (see the PIDs above), then run npm run dev again.\n");
  }
  process.exit(1);
}

// Not fatal: the app works without the backend only until sign-in, so just say so.
const envFile = path.join(ROOT, "web", ".env.local");
let backend = "http://127.0.0.1:8000";
try {
  const m = fs.readFileSync(envFile, "utf8").match(/^BACKEND_URL=(.+)$/m);
  if (m) backend = m[1].trim();
} catch {
  /* no .env.local yet */
}
fetch(`${backend.replace(/\/$/, "")}/api/health`, { signal: AbortSignal.timeout(2500) })
  .then((r) => { if (!r.ok) throw new Error(String(r.status)); })
  .catch(() => {
    console.warn(`\nNote: the backend is not answering at ${backend}. Sign-in, invitations and alerts need it: run  npm run backend:up  (Docker) and check BACKEND_URL in web/.env.local.\n`);
  });
