"""Heirloom backend settings. Everything environment-specific comes from env vars (see .env.example)."""
import os
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def env(name: str, default: str | None = None) -> str | None:
    return os.environ.get(name, default)


def env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [x.strip() for x in os.environ.get(name, default).split(",") if x.strip()]


DEBUG = env_bool("DJANGO_DEBUG", False)

SECRET_KEY = env("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set when DJANGO_DEBUG is off")
    SECRET_KEY = "insecure-dev-only-key-" + "x" * 40  # never used outside DEBUG

# Render exposes the service's public hostname; it is always allowed so a fresh deploy answers before anything else is configured.
_render_host = env("RENDER_EXTERNAL_HOSTNAME")
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1" if DEBUG else "") + ([_render_host] if _render_host else [])

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "accounts",
    "keys",
    "invites",
    "indexer",
    "notifications",
    "alerts",
    "ops",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "accounts.middleware.OriginCheckMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
TEMPLATES = []  # JSON API only

AUTH_USER_MODEL = "accounts.User"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---- Database (Neon Postgres in production; SQLite when DATABASE_URL is unset, for local runs and tests) ----------------
DATABASES = {"default": dj_database_url.config(default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}", conn_max_age=60, conn_health_checks=True)}
_db = DATABASES["default"]
if "postgres" in _db.get("ENGINE", ""):
    _opts = _db.setdefault("OPTIONS", {})
    # Neon's pooled endpoint (PgBouncer, transaction mode) cannot keep server-side prepared statements or cursors across transactions.
    _opts.setdefault("prepare_threshold", None)
    _db["DISABLE_SERVER_SIDE_CURSORS"] = True
    if _db.get("HOST") not in ("", "localhost", "127.0.0.1", None):
        _opts.setdefault("sslmode", "require")  # a hosted database is never reached without TLS

# ---- Cache: nonces, rate limits ---------------------------------------------------------------------------------------
# Shared by every gunicorn worker, so it lives in the database (table created by `createcachetable` at build time).
CACHES = {"default": {"BACKEND": "django.core.cache.backends.db.DatabaseCache", "LOCATION": "django_cache"}}

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_TZ = True

# ---- Static files (served by WhiteNoise; this API has few, but the setup is standard) ---------------------------------
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}

# ---- request limits --------------------------------------------------------------------------
DATA_UPLOAD_MAX_MEMORY_SIZE = 64 * 1024  # JSON bodies here are tiny (a key blob is < 2 KB)

# ---- Origins ---------------------------------------------------------------------------------
FRONTEND_URL = env("FRONTEND_URL", "http://localhost:3000").rstrip("/")
ALLOWED_ORIGINS = env_list("ALLOWED_ORIGINS", FRONTEND_URL)
CORS_ALLOWED_ORIGINS = ALLOWED_ORIGINS  # only the web app's own origin
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", ",".join(ALLOWED_ORIGINS))

# ---- Sign-In With Ethereum --------------------------------------------------------------------
# Hosts (with port) of the frontend that may appear as the SIWE "domain".
SIWE_ALLOWED_DOMAINS = env_list("SIWE_ALLOWED_DOMAINS", "localhost:3000")
SIWE_CHAIN_IDS = [int(x) for x in env_list("SIWE_CHAIN_IDS", "31337,11155111,80002")]
SIWE_STATEMENT = "Sign in to Heirloom. This does not cost gas and does not give access to your funds."
SIWE_NONCE_TTL_SECONDS = 300

# ---- Session (JWT in an httpOnly cookie) ------------------------------------------------------
JWT_COOKIE_NAME = "heirloom_session"
JWT_LIFETIME_SECONDS = int(env("JWT_LIFETIME_SECONDS", str(8 * 3600)))
JWT_COOKIE_SECURE = not DEBUG
JWT_COOKIE_SAMESITE = "Lax"
JWT_ALGORITHM = "HS256"

# ---- Invites ----------------------------------------------------------------------------------
INVITE_TTL_SECONDS = int(env("INVITE_TTL_SECONDS", str(7 * 24 * 3600)))
MAX_ACTIVE_INVITES_PER_OWNER = 50

# ---- Email: the Resend HTTP API (no SMTP). Without a key, mail is printed to the log (development). ---------------------
RESEND_API_KEY = env("RESEND_API_KEY", "")
EMAIL_BACKEND = env("EMAIL_BACKEND") or ("notifications.resend_backend.ResendEmailBackend" if RESEND_API_KEY else "django.core.mail.backends.console.EmailBackend")
# Until a domain is verified in Resend, only onboarding@resend.dev works as the sender, and only to the account owner's own address.
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", "Heirloom <onboarding@resend.dev>" if RESEND_API_KEY else "Heirloom <no-reply@heirloom.local>")

# ---- DRF --------------------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["accounts.auth.JWTCookieAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    # Number of trusted reverse proxies in front of the app, so client IPs for throttling cannot be spoofed.
    # On Render the request passes through its load balancer, and (on Vercel) the Next.js rewrite: set 2.
    "NUM_PROXIES": int(env("NUM_PROXIES", "0")),
    "DEFAULT_THROTTLE_RATES": {
        "default": "120/min",
        "auth_nonce": "30/min",
        "auth_verify": "10/min",
        "invite_preview": "30/min",
        "invite_create": "30/hour",
        "invite_resend": "10/hour",
        "alive_preview": "30/min",
        "alive_consume": "20/min",
        "verify_start": "6/hour",
        "verify_confirm": "30/hour",
    },
    "UNAUTHENTICATED_USER": None,
}

# ---- Security (production: DEBUG off) ---------------------------------------------------------
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", True)
    SECURE_REDIRECT_EXEMPT = [r"^health$"]  # the platform's health check may arrive over plain HTTP
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}


# ---- Blockchain indexer -----------------------------------------------------------------------
# Contract ABI and per-chain deployments (written by contracts/scripts/deploy.js). Re-read on every run, so a
# redeploy is picked up without restarting. deployments.json holds the public networks (committed);
# deployments.local.json holds a local dev chain (git-ignored).
CHAIN_DIR = Path(env("CHAIN_DIR", str(BASE_DIR / "chain")))
# Only index these chains (comma-separated ids). Empty: every chain in the deployment files.
ACTIVE_CHAIN_IDS = [int(x) for x in env_list("ACTIVE_CHAIN_IDS")]

# JSON-RPC endpoints per chain id.
RPC_URLS = {
    31337: env("RPC_URL_31337", "http://127.0.0.1:8545"),
    11155111: env("RPC_URL_11155111", "https://ethereum-sepolia-rpc.publicnode.com"),
    80002: env("RPC_URL_80002", "https://rpc-amoy.polygon.technology"),
}
# Some free RPC plans cap eth_getLogs at a few blocks (Alchemy free: 10). A second endpoint can serve only the log queries.
LOGS_RPC_URLS = {cid: env(f"LOGS_RPC_URL_{cid}", "") for cid in (31337, 11155111, 80002)}

# Blocks an event must be buried under before it is indexed (and so before anyone is emailed about it).
# A local dev chain never reorgs; public chains can, and Polygon more deeply than Ethereum.
CONFIRMATIONS = {
    31337: int(env("CONFIRMATIONS_31337", "0")),
    11155111: int(env("CONFIRMATIONS_11155111", "4")),
    80002: int(env("CONFIRMATIONS_80002", "30")),
}
INDEX_CHUNK_BLOCKS = int(env("INDEX_CHUNK_BLOCKS", "2000"))  # stay under public RPC getLogs range limits
# Per-chain override, for RPCs with tighter limits.
INDEX_CHUNK_BLOCKS_BY_CHAIN = {cid: int(env(f"INDEX_CHUNK_BLOCKS_{cid}") or INDEX_CHUNK_BLOCKS) for cid in (31337, 11155111, 80002)}
INDEX_MAX_CHUNKS_PER_RUN = int(env("INDEX_MAX_CHUNKS_PER_RUN", "50"))
INDEX_STALE_AFTER_SECONDS = int(env("INDEX_STALE_AFTER_SECONDS", "120"))

# ---- The scheduler's tick (POST /internal/tick, called every minute by an external cron service) ---------------------------
TICK_SECRET = env("TICK_SECRET", "")
TICK_BUDGET_SECONDS = float(env("TICK_BUDGET_SECONDS", "24"))  # a tick must answer well inside a 30 s HTTP timeout
TICK_LEASE_SECONDS = int(env("TICK_LEASE_SECONDS", "60"))  # a crashed tick frees its lock after this long

# ---- Reminders --------------------------------------------------------------------------------
HEARTBEAT_REMINDER_FRACTION = 0.25  # remind the owner once this fraction of the check-in interval remains
DEADLINE_REMINDER_FRACTION = 0.25  # remind silent guardians once this fraction of the attestation window remains

# ---- Claim alerts (owner escalation, guardian warning) --------------------------------------------
ALERT_SMS_AFTER_SECONDS = int(env("ALERT_SMS_AFTER_SECONDS", str(72 * 3600)))  # SMS the owner this long after the claim, if no check-in
ALERT_GUARDIAN_BEFORE_END_SECONDS = int(env("ALERT_GUARDIAN_BEFORE_END_SECONDS", str(24 * 3600)))  # warn guardians this long before the end
VERIFICATION_CODE_TTL_SECONDS = int(env("VERIFICATION_CODE_TTL_SECONDS", "600"))
# SMS is off unless explicitly enabled (and Twilio configured): the free deployment sends email only.
SMS_ENABLED = env_bool("SMS_ENABLED", False)
SMS_BACKEND = env("SMS_BACKEND", "alerts.sms.TwilioBackend")
TWILIO_ACCOUNT_SID = env("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = env("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = env("TWILIO_FROM_NUMBER", "")  # a Twilio number or messaging-service sender, E.164
NOTIFICATION_EMAIL_MAX_ATTEMPTS = 6  # delivery is retried on later ticks, then given up
