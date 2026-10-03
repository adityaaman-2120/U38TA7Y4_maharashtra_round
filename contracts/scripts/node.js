// Starts a local Hardhat node. Binds to 127.0.0.1 unless HARDHAT_HOST is set.
// The backend's indexer runs in Docker and reaches the node through the host, which needs HARDHAT_HOST=0.0.0.0.
// The node's 20 accounts and their private keys are public: only expose it on a network you trust, and never fund them.
const { spawn } = require("child_process");

const host = process.env.HARDHAT_HOST || "127.0.0.1";
const child = spawn("npx", ["hardhat", "node", "--hostname", host], { stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
