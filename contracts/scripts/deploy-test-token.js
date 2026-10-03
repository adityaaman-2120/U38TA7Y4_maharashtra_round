// Deploys the faucet test ERC-20 (HTT) to the selected TEST network and registers it with the web app.
//   Amoy:  set DEPLOYER_PRIVATE_KEY (and optionally AMOY_RPC_URL), then  npm run deploy:token:amoy
// Refused on anything that is not a known test network.
const hre = require("hardhat");
const { deployTestToken } = require("./lib/generate");

const TEST_NETWORKS = ["localhost", "hardhat", "amoy", "sepolia"];

async function main() {
  if (!TEST_NETWORKS.includes(hre.network.name)) throw new Error(`The test token is for test networks only (${TEST_NETWORKS.join(", ")}).`);
  const heirloom = await hre.ethers.getContractFactory("Heirloom");
  const t = await deployTestToken(hre, JSON.parse(heirloom.interface.formatJson()));
  console.log(`${t.name} (${t.symbol}) deployed to ${t.address} on ${hre.network.name} (chainId ${t.chainId}, block ${t.startBlock}).`);
  console.log("Anyone can call faucet() on it for 1000 HTT per hour; the owner page has a button for that.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
