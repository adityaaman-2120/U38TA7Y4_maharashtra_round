// Secrets come from the environment (contracts/.env, git-ignored); never commit them.
require("dotenv").config({ quiet: true });
require("@nomicfoundation/hardhat-toolbox");

const { AMOY_RPC_URL, SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, POLYGONSCAN_API_KEY } = process.env;
const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY.startsWith("0x") ? DEPLOYER_PRIVATE_KEY : `0x${DEPLOYER_PRIVATE_KEY}`] : [];

/** @type import("hardhat/config").HardhatUserConfig */
module.exports = {
  solidity: { version: "0.8.24", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 } } },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    sepolia: { url: SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", chainId: 11155111, accounts },
    amoy: { url: AMOY_RPC_URL || "https://rpc-amoy.polygon.technology", chainId: 80002, accounts },
  },
  // One Etherscan-family key verifies on Polygon Amoy through the Etherscan v2 API (https://polygonscan.com keys work).
  etherscan: { apiKey: POLYGONSCAN_API_KEY || "" },
  sourcify: { enabled: false },
};
