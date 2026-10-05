// Publishes the source of every contract in deployments/<network>.json (and the test token, if any) on the block explorer.
//   Usage:  hardhat run scripts/verify.js --network amoy        needs POLYGONSCAN_API_KEY in contracts/.env
// Safe to run again: a contract that is already verified is reported and skipped.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const read = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);

async function verify(label, address, constructorArguments = [], contract) {
  try {
    await hre.run("verify:verify", { address, constructorArguments, ...(contract ? { contract } : {}) });
    console.log(`verified   ${label} ${address}`);
  } catch (e) {
    const msg = String(e.message || e);
    if (/already verified/i.test(msg)) console.log(`already    ${label} ${address}`);
    else {
      console.error(`FAILED     ${label} ${address}: ${msg.split("\n")[0]}`);
      process.exitCode = 1;
    }
  }
}

async function main() {
  if (["localhost", "hardhat"].includes(hre.network.name)) throw new Error("Nothing to verify on a local network.");
  if (!process.env.POLYGONSCAN_API_KEY) throw new Error("Set POLYGONSCAN_API_KEY in contracts/.env.");
  const d = read(path.join(__dirname, "..", "deployments", `${hre.network.name}.json`));
  if (!d) throw new Error(`No deployment record for ${hre.network.name}. Run the deploy script first.`);

  // Explorers need a few blocks before they can see a fresh contract.
  await new Promise((r) => setTimeout(r, 15000));
  await verify("Heirloom", d.address, [d.anonAadhaar, d.nullifierSeed], "contracts/Heirloom.sol:Heirloom");
  if (d.groth16Verifier) {
    await verify("Groth16 Verifier", d.groth16Verifier);
    await verify("AnonAadhaar", d.anonAadhaar, [d.groth16Verifier, d.anonAadhaarPubkeyHash]);
  }
  const token = read(path.join(__dirname, "..", "deployments", "tokens", `${hre.network.name}.json`));
  if (token) await verify("TestToken", token.address, [], "contracts/TestToken.sol:TestToken");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
