// Deploys Heirloom (and its Anon Aadhaar verifier) to the selected network and writes the addresses, ABI and deploy block to every
// place that needs them:
//   contracts/deployments/<network>.json          the record (committed for public networks)
//   web/src/lib/contracts.ts                      ABI + deployments the web app is built with
//   backend/chain/Heirloom.abi.json               ABI for the indexer
//   backend/chain/deployments.json                public networks (committed)   |  deployments.local.json: the local dev chain (git-ignored)
// Usage:  hardhat run scripts/deploy.js --network localhost|sepolia|amoy        (then, on a public network: npm run verify:amoy)
//
// Resumable on public networks: every contract's address is written to the record the moment it is mined, and a re-run reuses
// whatever is already deployed (checked on chain) instead of paying for it again. Before each deployment the estimated cost is
// printed in the native token, and the script stops, spending nothing, if the account cannot cover it. Local chains always start fresh.
//
// Identity verifier, chosen by environment:
//   (default)                       deploy the official Groth16 Verifier + AnonAadhaar from @anon-aadhaar/contracts.
//   ANON_AADHAAR_MODE=test|real     which UIDAI public key the verifier trusts: "test" (default) accepts only test QR codes
//                                   made with the published test key; "real" accepts only genuine UIDAI-signed Aadhaar QR codes.
//   ANON_AADHAAR_VERIFIER=0x...     use an already deployed AnonAadhaar contract instead of deploying one.
//   ANON_AADHAAR_VERIFIER=none      no verifier: identity features are disabled on this deployment.
//   ANON_AADHAAR_VERIFIER=mock      deploy the TEST DOUBLE (accepts "proofs" that merely commit to the public inputs). Local
//                                   chains only; refused everywhere else.
//   ANON_AADHAAR_NULLIFIER_SEED     this app's nullifier seed (default: keccak256("heirloom.anon-aadhaar.v1") >> 8).
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { writeContractsTs, deployTestToken } = require("./lib/generate");
const { testPublicKeyHash, productionPublicKeyHash } = require("@anon-aadhaar/core");

const DEPLOYMENTS = path.join(__dirname, "..", "deployments");
const BACKEND_CHAIN = path.join(__dirname, "..", "..", "backend", "chain");
const LOCAL = ["localhost", "hardhat"];
const isLocal = () => LOCAL.includes(hre.network.name);
const RECORD = () => path.join(DEPLOYMENTS, `${hre.network.name}.json`);

// Local chains start empty every time. Top up your own wallet(s) so MetaMask never shows a fee warning.
// Addresses come from FUND_ADDRESSES (comma-separated) and/or contracts/fund.local.json (a JSON array; gitignored).
async function fundLocalWallets() {
  const list = [...(process.env.FUND_ADDRESSES ? process.env.FUND_ADDRESSES.split(",") : [])];
  const file = path.join(__dirname, "..", "fund.local.json");
  if (fs.existsSync(file)) list.push(...JSON.parse(fs.readFileSync(file, "utf8")));
  for (const raw of list.map((a) => a.trim()).filter(Boolean)) {
    const addr = hre.ethers.getAddress(raw);
    await hre.network.provider.send("hardhat_setBalance", [addr, "0x" + (10_000n * 10n ** 18n).toString(16)]);
    console.log(`Funded ${addr} with 10000 test ETH`);
  }
}

// The backend indexer reads the ABI and the deployed addresses from backend/chain/. A public network goes into the committed
// deployments.json; a local dev chain goes into deployments.local.json (git-ignored), so a local run never changes what is deployed.
function writeBackendChain(abi, chainId, address, startBlock) {
  fs.mkdirSync(BACKEND_CHAIN, { recursive: true });
  fs.writeFileSync(path.join(BACKEND_CHAIN, "Heirloom.abi.json"), JSON.stringify(abi, null, 1));
  const file = path.join(BACKEND_CHAIN, isLocal() ? "deployments.local.json" : "deployments.json");
  const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  all[chainId] = { address, startBlock };
  fs.writeFileSync(file, JSON.stringify(all, null, 2));
}

// The record on disk: what is already deployed on this network. Rewritten after every deployment so a crash loses nothing.
let record = {};
function loadRecord() {
  if (isLocal() || !fs.existsSync(RECORD())) return;
  record = JSON.parse(fs.readFileSync(RECORD(), "utf8"));
}
function saveRecord(patch) {
  record = { ...record, ...patch };
  fs.mkdirSync(DEPLOYMENTS, { recursive: true });
  fs.writeFileSync(RECORD(), JSON.stringify(record, null, 2));
}

const pol = (wei) => `${Number(hre.ethers.formatEther(wei)).toFixed(4)} ${hre.network.config.chainId === 11155111 ? "ETH" : "POL"}`;
const hasCode = async (address) => !!address && (await hre.ethers.provider.getCode(address)) !== "0x";

// Some public RPCs suggest a far higher tip than the network needs (Amoy's real minimum is 25 gwei; an RPC may suggest 350).
// GAS_TIP_GWEI=25 overrides the tip; the max fee then becomes 2 x the current base fee + the tip. Unset = the network's own fee data.
async function feeOverrides() {
  const tipGwei = (process.env.GAS_TIP_GWEI || "").trim();
  if (!tipGwei) return {};
  const tip = hre.ethers.parseUnits(tipGwei, "gwei");
  const block = await hre.ethers.provider.getBlock("latest");
  return { maxPriorityFeePerGas: tip, maxFeePerGas: (block.baseFeePerGas ?? 0n) * 2n + tip };
}

// Estimates what deploying `factory` with `args` will cost at the network's current fees (an upper bound: the maximum fee per gas),
// prints it, and throws before anything is sent if the account cannot pay.
async function checkAffordable(label, factory, args, deployer) {
  const tx = await factory.getDeployTransaction(...args);
  const gas = await hre.ethers.provider.estimateGas({ ...tx, from: deployer.address });
  const fees = { ...(await hre.ethers.provider.getFeeData()), ...(await feeOverrides()) };
  const perGas = fees.maxFeePerGas ?? fees.gasPrice;
  if (!perGas) throw new Error("The network returned no fee data; try again or use another RPC URL.");
  const cost = gas * perGas;
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`${label}: ~${gas.toLocaleString("en-US")} gas at up to ${hre.ethers.formatUnits(perGas, "gwei")} gwei = up to ${pol(cost)}  (balance ${pol(balance)})`);
  if (balance < cost) {
    throw new Error(
      `Not enough funds to deploy ${label}: it needs up to ${pol(cost)} and ${deployer.address} holds ${pol(balance)}. ` +
        `Add at least ${pol(cost - balance)} from a faucet and run the same command again: what is already deployed is kept in ${path.relative(process.cwd(), RECORD())} and will not be paid for twice.`
    );
  }
}

// Deploys one contract (after the affordability check), waits for it, and returns { address, blockNumber }.
async function deployOne(label, factory, args, deployer) {
  if (!isLocal()) await checkAffordable(label, factory, args, deployer);
  const contract = await factory.deploy(...args, await feeOverrides());
  const receipt = await contract.deploymentTransaction().wait(isLocal() ? 1 : 2);
  const address = await contract.getAddress();
  console.log(`  deployed ${label} at ${address} (block ${receipt.blockNumber})`);
  return { address, blockNumber: receipt.blockNumber, txHash: receipt.hash };
}

async function resolveVerifier(chainId, deployer) {
  const choice = (process.env.ANON_AADHAAR_VERIFIER || "").trim();
  if (choice === "none") return { address: hre.ethers.ZeroAddress, mode: "none" };
  if (choice === "mock") {
    if (!isLocal()) throw new Error("ANON_AADHAAR_VERIFIER=mock is a test double and is refused on public networks.");
    const mock = await deployOne("MockAnonAadhaar", await hre.ethers.getContractFactory("MockAnonAadhaar"), [], deployer);
    console.log("WARNING: deployed the MOCK Anon Aadhaar verifier. Proofs are not verified cryptographically.");
    return { address: mock.address, mode: "mock" };
  }
  if (choice) {
    const address = hre.ethers.getAddress(choice);
    if (!isLocal() && !(await hasCode(address))) throw new Error(`ANON_AADHAAR_VERIFIER ${address} has no contract on ${hre.network.name}.`);
    return { address, mode: "custom" };
  }

  const mode = (process.env.ANON_AADHAAR_MODE || "test").toLowerCase();
  if (!["test", "real"].includes(mode)) throw new Error('ANON_AADHAAR_MODE must be "test" or "real".');
  const pubkeyHash = mode === "real" ? productionPublicKeyHash : testPublicKeyHash;

  // Reuse a verifier from an earlier (possibly interrupted) run, if it is on chain and was built for the same public key.
  if (record.anonAadhaar && record.anonAadhaarMode === mode && record.anonAadhaarPubkeyHash === String(pubkeyHash) && (await hasCode(record.anonAadhaar))) {
    console.log(`Reusing the Anon Aadhaar verifier already deployed at ${record.anonAadhaar}`);
    return { address: record.anonAadhaar, mode, groth16: record.groth16Verifier, pubkeyHash: String(pubkeyHash) };
  }
  let groth16 = record.groth16Verifier;
  if (record.anonAadhaar) {
    console.log("The recorded verifier does not match this run's settings; deploying a new one.");
    saveRecord({ anonAadhaar: undefined, anonAadhaarMode: undefined, anonAadhaarPubkeyHash: undefined });
  }
  if (groth16 && (await hasCode(groth16))) console.log(`Reusing the Groth16 verifier already deployed at ${groth16}`);
  else {
    groth16 = (await deployOne("Groth16 Verifier", await hre.ethers.getContractFactory("Verifier"), [], deployer)).address;
    saveRecord({ chainId: Number(chainId), deployer: deployer.address, groth16Verifier: groth16 });
  }
  const anon = await deployOne("AnonAadhaar", await hre.ethers.getContractFactory("AnonAadhaar"), [groth16, pubkeyHash], deployer);
  saveRecord({ anonAadhaar: anon.address, anonAadhaarMode: mode, anonAadhaarPubkeyHash: String(pubkeyHash) });
  return { address: anon.address, mode, groth16, pubkeyHash: String(pubkeyHash) };
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("No deployer account. For a public network set DEPLOYER_PRIVATE_KEY (and the RPC URL) in contracts/.env.");
  const { chainId } = await hre.ethers.provider.getNetwork();
  loadRecord();
  if (!isLocal()) {
    const balance = await hre.ethers.provider.getBalance(deployer.address);
    console.log(`Deploying from ${deployer.address} (balance ${pol(balance)}) to ${hre.network.name}...`);
    if (balance === 0n) throw new Error("The deployer account has no funds for gas. Fund it from a faucet first.");
  }

  const verifier = await resolveVerifier(chainId, deployer);
  const seed = BigInt(process.env.ANON_AADHAAR_NULLIFIER_SEED || BigInt(hre.ethers.id("heirloom.anon-aadhaar.v1")) >> 8n);

  const factory = await hre.ethers.getContractFactory("Heirloom");
  let address, startBlock, txHash;
  if (record.address && record.anonAadhaar === verifier.address && record.nullifierSeed === seed.toString() && (await hasCode(record.address))) {
    ({ address, startBlock, txHash } = record);
    console.log(`Reusing the Heirloom contract already deployed at ${address}`);
  } else {
    if (record.address) console.log("The recorded Heirloom contract does not match this run's verifier/seed (or is gone); deploying a new one.");
    const h = await deployOne("Heirloom", factory, [verifier.address, seed], deployer);
    ({ address, txHash } = h);
    startBlock = h.blockNumber;
    saveRecord({ address, startBlock, txHash, anonAadhaar: verifier.address, anonAadhaarMode: verifier.mode, nullifierSeed: seed.toString() });
  }

  saveRecord({
    chainId: Number(chainId), address, startBlock, deployer: deployer.address, txHash,
    anonAadhaar: verifier.address, anonAadhaarMode: verifier.mode, nullifierSeed: seed.toString(),
    ...(verifier.groth16 ? { groth16Verifier: verifier.groth16, anonAadhaarPubkeyHash: verifier.pubkeyHash } : {}),
  });
  const abi = JSON.parse(factory.interface.formatJson());
  writeContractsTs(abi);
  writeBackendChain(abi, Number(chainId), address, startBlock);
  if (isLocal()) {
    await fundLocalWallets();
    const t = await deployTestToken(hre, abi); // a fresh local chain has no tokens: deploy the faucet token so the crypto UI is usable
    console.log(`Test token ${t.symbol} deployed to ${t.address}`);
  }
  console.log(`Heirloom deployed to ${address} on ${hre.network.name} (chainId ${chainId}, block ${startBlock}); identity verifier: ${verifier.mode}`);
  if (!isLocal()) {
    console.log(`\nNext: npm run verify:${hre.network.name === "amoy" ? "amoy" : "sepolia"}   (publishes the source on the block explorer)`);
    console.log("Then commit contracts/deployments, backend/chain and web/src/lib/contracts.ts, and set these in Vercel:");
    console.log(`  NEXT_PUBLIC_CHAIN_ID=${chainId}\n  NEXT_PUBLIC_CONTRACT_ADDRESS=${address}\n  NEXT_PUBLIC_CONTRACT_START_BLOCK=${startBlock}`);
  }
}

main().catch((e) => {
  console.error(e.message?.startsWith("Not enough funds") || e.message?.startsWith("ANON_") ? e.message : e);
  process.exitCode = 1;
});
