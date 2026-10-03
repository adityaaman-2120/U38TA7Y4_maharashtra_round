const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { testPublicKeyHash } = require("@anon-aadhaar/core");

// Wires Heirloom to the REAL Anon Aadhaar contracts (Groth16 verifier + AnonAadhaar, test public key). No real proof can be
// produced here (that needs the 600 MB circuit key and a signed QR), so this checks that the stack deploys and
// that junk is refused cleanly, never accepted and never crashing the transaction in a confusing way.
describe("Heirloom with the real Anon Aadhaar verifier", () => {
  it("deploys, and refuses invalid proofs with InvalidProof", async () => {
    const [owner, user] = await ethers.getSigners();
    const verifier = await (await ethers.getContractFactory("Verifier")).deploy();
    const aa = await (await ethers.getContractFactory("AnonAadhaar")).deploy(await verifier.getAddress(), testPublicKeyHash);
    expect(await aa.storedPublicKeyHash()).to.equal(BigInt(testPublicKeyHash));
    const h = await (await ethers.getContractFactory("Heirloom")).deploy(await aa.getAddress(), 1234567n);

    const now = await time.latest();
    const junk = { nullifier: 123456789n, timestamp: now, revealArray: [0, 0, 0, 0], groth16Proof: [1, 2, 3, 4, 5, 6, 7, 8] };
    await expect(h.connect(user).verifyIdentity(junk)).to.be.revertedWithCustomError(h, "InvalidProof");
    const outOfField = { ...junk, groth16Proof: Array(8).fill(ethers.MaxUint256) };
    await expect(h.connect(user).verifyIdentity(outOfField)).to.be.revertedWithCustomError(h, "InvalidProof");
    expect(await h.isVerified(user.address)).to.equal(false);
    void owner;
  });
});
