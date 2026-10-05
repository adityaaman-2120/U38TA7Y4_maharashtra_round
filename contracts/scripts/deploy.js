// Deploys Heirloom (and its Anon Aadhaar verifier) to the selected network and writes the addresses, ABI and deploy block to every
// place that needs them:
//   contracts/deployments/<network>.json          the record (committed for public networks)
//   web/src/lib/contracts.ts                      ABI + deployments the web app is built with
//   backend/chain/Heirloom.abi.json               ABI for the indexer
//   backend/chain/deployments.json                public networks (committed)   |  deployments.local.json: the local dev chain (git-ignored)
// Usage:  hardhat run scripts/deploy.js --network localhost|sepolia|amoy        (then, on a public network: npm run verify:amoy)
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

async function deployVerifier(chainId) {
  const choice = (process.env.ANON_AADHAAR_VERIFIER || "").trim();
  if (choice === "none") return { address: hre.ethers.ZeroAddress, mode: "none" };
  if (choice === "mock") {
    if (!isLocal()) throw new Error("ANON_AADHAAR_VERIFIER=mock is a test double and is refused on public networks.");
    const mock = await (await hre.ethers.getContractFactory("MockAnonAadhaar")).deploy();
    await mock.waitForDeployment();
    console.log("WARNING: deployed the MOCK Anon Aadhaar verifier. Proofs are not verified cryptographically.");
    return { address: await mock.getAddress(), mode: "mock" };
  }
  if (choice) return { address: hre.ethers.getAddress(choice), mode: "custom" };

  const mode = (process.env.ANON_AADHAAR_MODE || "test").toLowerCase();
  if (!["test", "real"].includes(mode)) throw new Error('ANON_AADHAAR_MODE must be "test" or "real".');
  const pubkeyHash = mode === "real" ? productionPublicKeyHash : testPublicKeyHash;
  const groth16 = await (await hre.ethers.getContractFactory("Verifier")).deploy();
  await groth16.waitForDeployment();
  const anon = await (await hre.ethers.getContractFactory("AnonAadhaar")).deploy(await groth16.getAddress(), pubkeyHash);
  await anon.waitForDeployment();
  console.log(`Deployed Anon Aadhaar verifier (${mode} public key) on chain ${chainId}.`);
  return { address: await anon.getAddress(), mode, groth16: await groth16.getAddress(), pubkeyHash: String(pubkeyHash) };
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("No deployer account. For a public network set DEPLOYER_PRIVATE_KEY (and the RPC URL) in contracts/.env.");
  const { chainId } = await hre.ethers.provider.getNetwork();
  if (!isLocal()) {
    const balance = await hre.ethers.provider.getBalance(deployer.address);
    console.log(`Deploying from ${deployer.address} (balance ${hre.ethers.formatEther(balance)}) to ${hre.network.name}...`);
    if (balance === 0n) throw new Error("The deployer account has no funds for gas. Fund it from a faucet first.");
  }

  const verifier = await deployVerifier(chainId);
  const seed = BigInt(process.env.ANON_AADHAAR_NULLIFIER_SEED || BigInt(hre.ethers.id("heirloom.anon-aadhaar.v1")) >> 8n);

  const factory = await hre.ethers.getContractFactory("Heirloom");
  const contract = await factory.deploy(verifier.address, seed);
  const receipt = await contract.deploymentTransaction().wait(isLocal() ? 1 : 2);
  const address = await contract.getAddress();

  fs.mkdirSync(DEPLOYMENTS, { recursive: true });
  fs.writeFileSync(
    path.join(DEPLOYMENTS, `${hre.network.name}.json`),
    JSON.stringify(
      {
        chainId: Number(chainId), address, startBlock: receipt.blockNumber, deployer: deployer.address, txHash: receipt.hash,
        anonAadhaar: verifier.address, anonAadhaarMode: verifier.mode, nullifierSeed: seed.toString(),
        ...(verifier.groth16 ? { groth16Verifier: verifier.groth16, anonAadhaarPubkeyHash: verifier.pubkeyHash } : {}),
      },
      null,
      2
    )
  );
  const abi = JSON.parse(factory.interface.formatJson());
  writeContractsTs(abi);
  writeBackendChain(abi, Number(chainId), address, receipt.blockNumber);
  if (isLocal()) {
    await fundLocalWallets();
    const t = await deployTestToken(hre, abi); // a fresh local chain has no tokens: deploy the faucet token so the crypto UI is usable
    console.log(`Test token ${t.symbol} deployed to ${t.address}`);
  }
  console.log(`Heirloom deployed to ${address} on ${hre.network.name} (chainId ${chainId}, block ${receipt.blockNumber}); identity verifier: ${verifier.mode}`);
  if (!isLocal()) {
    console.log(`\nNext: npm run verify:${hre.network.name === "amoy" ? "amoy" : "sepolia"}   (publishes the source on the block explorer)`);
    console.log("Then commit contracts/deployments, backend/chain and web/src/lib/contracts.ts, and set these in Vercel:");
    console.log(`  NEXT_PUBLIC_CHAIN_ID=${chainId}\n  NEXT_PUBLIC_CONTRACT_ADDRESS=${address}\n  NEXT_PUBLIC_CONTRACT_START_BLOCK=${receipt.blockNumber}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
