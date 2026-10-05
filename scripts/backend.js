// Runs the Django backend locally (no Docker). Usage:  node scripts/backend.js <command>
//   setup    create backend/.venv and install requirements
//   migrate  apply migrations and create the cache table (against DATABASE_URL, or SQLite when it is unset)
//   dev      migrate, then serve the API on http://127.0.0.1:$BACKEND_PORT (default 8000)
//   test     run the backend tests (always on a throwaway SQLite database, never on DATABASE_URL)
//   tick     call POST /internal/tick once;  `tick --watch [seconds]` repeats it (a local stand-in for cron-job.org)
//   flush    delete every row (keeps the tables). For test runs against a throwaway database: it asks nothing, so do not point it at real data
//   shell    open a Django shell with the backend environment
// Settings come from backend/.env (git-ignored); see backend/.env.example.
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const BACK = path.join(ROOT, "backend");
const VENV_PY = path.join(BACK, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

const fileEnv = loadEnv(path.join(BACK, ".env"));
const env = { ...fileEnv, ...process.env };

function run(args, opts = {}) {
  const r = spawnSync(VENV_PY, args, { cwd: BACK, stdio: "inherit", env: opts.env ?? env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function requireVenv() {
  if (!fs.existsSync(VENV_PY)) {
    console.error("The backend environment is missing. Run:  npm run backend:setup");
    process.exit(1);
  }
}

const cmd = process.argv[2];
const port = env.BACKEND_PORT || "8000";

async function tick(watchSeconds) {
  const secret = env.TICK_SECRET;
  if (!secret) throw new Error("Set TICK_SECRET in backend/.env first.");
  const once = async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/internal/tick`, { method: "POST", headers: { "X-Tick-Secret": secret }, signal: AbortSignal.timeout(40000) });
      const body = await res.json().catch(() => ({}));
      console.log(new Date().toISOString(), res.status, JSON.stringify(body));
    } catch (e) {
      console.log(new Date().toISOString(), "tick failed:", e.message);
    }
  };
  await once();
  if (watchSeconds) setInterval(once, watchSeconds * 1000);
}

switch (cmd) {
  case "setup": {
    if (!fs.existsSync(VENV_PY)) {
      const mk = spawnSync(process.platform === "win32" ? "py" : "python3", process.platform === "win32" ? ["-3", "-m", "venv", ".venv"] : ["-m", "venv", ".venv"], { cwd: BACK, stdio: "inherit" });
      if (mk.status !== 0) process.exit(mk.status ?? 1);
    }
    run(["-m", "pip", "install", "--upgrade", "pip"]);
    run(["-m", "pip", "install", "-r", "requirements.txt"]);
    break;
  }
  case "migrate":
    requireVenv();
    run(["manage.py", "migrate", "--noinput"]);
    run(["manage.py", "createcachetable"]);
    break;
  case "dev": {
    requireVenv();
    const devEnv = { DJANGO_DEBUG: "1", ...env };
    run(["manage.py", "migrate", "--noinput"], { env: devEnv });
    run(["manage.py", "createcachetable"], { env: devEnv });
    const server = spawn(VENV_PY, ["manage.py", "runserver", `127.0.0.1:${port}`], { cwd: BACK, stdio: "inherit", env: devEnv });
    server.on("exit", (c) => process.exit(c ?? 0));
    break;
  }
  case "test": {
    requireVenv();
    const testEnv = { ...process.env, DJANGO_DEBUG: "0", DJANGO_SECRET_KEY: "test-only-secret-key-" + "x".repeat(30), SECURE_SSL_REDIRECT: "0", TICK_SECRET: "test-tick-secret" };
    // Never let a test run create or touch a hosted database.
    for (const k of ["DATABASE_URL", "RESEND_API_KEY", "EMAIL_BACKEND", "SMS_ENABLED", "TWILIO_ACCOUNT_SID", "ACTIVE_CHAIN_IDS", "LOGS_RPC_URL_80002", "RPC_URL_80002"]) delete testEnv[k];
    run(["manage.py", "test", "tests", ...process.argv.slice(3)], { env: testEnv });
    break;
  }
  case "tick":
    tick(process.argv[3] === "--watch" ? Number(process.argv[4] || 15) : 0).catch((e) => { console.error(e.message); process.exit(1); });
    break;
  case "flush":
    requireVenv();
    run(["manage.py", "flush", "--noinput"]);
    break;
  case "shell":
    requireVenv();
    run(["manage.py", "shell"]);
    break;
  default:
    console.error("usage: node scripts/backend.js setup|migrate|dev|test|tick|flush|shell");
    process.exit(2);
}
