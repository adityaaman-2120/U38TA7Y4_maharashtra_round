const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { hash: sdkHash } = require("@anon-aadhaar/core"); // the SDK the browser uses to hash signals

const SEED = 1234567890123456789012345678901234567890n;
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const HOUR = 3600;
const DAY = 86400;
const EV = { Death: 0, Incapacity: 1, Any: 2 };
const NONE = [0, 0, 0, 0];
const OVER_18 = [1, 0, 0, 0];
// Stand-ins for the nullifiers of three different people.
const N = { a: 11111111111111111111111111111111111111111111111111111111111111111111111n, b: 22222222222222222222222222222222222222222222222222222222222222222222222n, c: 33333333333333333333333333333333333333333333333333333333333333333333333n };

const randomPub = () => "0x04" + ethers.hexlify(ethers.randomBytes(64)).slice(2);
const shares = (n) => Array.from({ length: n }, (_, i) => "0x" + (i + 1).toString(16).padStart(2, "0").repeat(24));
const EMPTY = { nullifier: 0, timestamp: 0, revealArray: NONE, groth16Proof: [0, 0, 0, 0, 0, 0, 0, 0] };
const policy = (o = {}) => ({
  requiredApprovals: 2, challengePeriod: 600, minInactivity: 600, unlockAfter: 0, evidenceType: EV.Any, attestationDeadline: DAY,
  requireBeneficiaryZK: false, requireAge18: false, ...o,
});

async function fixture() {
  const [owner, g1, g2, g3, g4, ben, other, stranger, mallory] = await ethers.getSigners();
  const mock = await (await ethers.getContractFactory("MockAnonAadhaar")).deploy();
  const h = await (await ethers.getContractFactory("Heirloom")).deploy(await mock.getAddress(), SEED);
  for (const s of [owner, g1, g2, g3, g4, ben, other]) await h.connect(s).registerEncryptionKey(randomPub());

  /** A proof the mock accepts: it commits to exactly these public inputs. */
  const proof = async ({ nullifier, signal, ts, reveal = NONE, seed = SEED }) => {
    ts = ts ?? (await time.latest());
    const p = await mock.proofFor(seed, nullifier, ts, signal, reveal);
    return { nullifier, timestamp: ts, revealArray: reveal, groth16Proof: [...p] };
  };
  const idProof = async (who, nullifier, o = {}) => proof({ nullifier, signal: await h.identitySignal(who.address), ...o });
  const verify = async (who, nullifier) => h.connect(who).verifyIdentity(await idProof(who, nullifier));
  return { h, mock, proof, idProof, verify, owner, g1, g2, g3, g4, ben, other, stranger, mallory };
}

describe("Identity (Anon Aadhaar)", () => {
  describe("signals", () => {
    it("the contract and the Anon Aadhaar SDK hash a signal identically", async () => {
      const { h, mock, ben } = await loadFixture(fixture);
      const signals = [await h.identitySignal(ben.address), await h.claimSignal(1, ben.address), await h.ageSignal(7, ben.address), 1n, 2n ** 255n + 12345n];
      for (const sig of signals) {
        // The browser passes the signal to the SDK as a decimal string; the SDK hashes it, the verifier hashes the uint.
        expect(sdkHash(sig.toString())).to.equal((await mock.signalHashOf(sig)).toString());
      }
    });

    it("signals are domain-separated and bound to the use and the person", async () => {
      const { h, ben, other } = await loadFixture(fixture);
      const all = [
        await h.identitySignal(ben.address), await h.identitySignal(other.address),
        await h.claimSignal(1, ben.address), await h.claimSignal(2, ben.address), await h.claimSignal(1, other.address),
        await h.ageSignal(1, ben.address), await h.ageSignal(2, ben.address),
      ];
      expect(new Set(all.map(String)).size).to.equal(all.length);
    });
  });

  describe("verifyIdentity", () => {
    it("binds an address to a nullifier and emits IdentityVerified with no personal data", async () => {
      const { h, g1, idProof } = await loadFixture(fixture);
      const p = await idProof(g1, N.a);
      await expect(h.connect(g1).verifyIdentity(p)).to.emit(h, "IdentityVerified").withArgs(g1.address, N.a);
      expect(await h.nullifierOf(g1.address)).to.equal(N.a);
      expect(await h.nullifierOwner(N.a)).to.equal(g1.address);
      expect(await h.isVerified(g1.address)).to.equal(true);
      expect(h.interface.getEvent("IdentityVerified").inputs.map((i) => i.name)).to.deep.equal(["account", "nullifier"]);
    });

    it("one nullifier per address", async () => {
      const { h, g1, idProof, verify } = await loadFixture(fixture);
      await verify(g1, N.a);
      await expect(h.connect(g1).verifyIdentity(await idProof(g1, N.b))).to.be.revertedWithCustomError(h, "AlreadyVerified");
      expect(await h.nullifierOf(g1.address)).to.equal(N.a);
    });

    it("one address per nullifier: a person cannot verify a second wallet", async () => {
      const { h, g1, g2, idProof, verify } = await loadFixture(fixture);
      await verify(g1, N.a);
      await expect(h.connect(g2).verifyIdentity(await idProof(g2, N.a))).to.be.revertedWithCustomError(h, "NullifierAlreadyUsed");
      expect(await h.isVerified(g2.address)).to.equal(false);
    });

    it("the signal binds to msg.sender: a proof copied from the mempool is useless to anyone else", async () => {
      const { h, g1, mallory, idProof } = await loadFixture(fixture);
      const alices = await idProof(g1, N.a);
      await expect(h.connect(mallory).verifyIdentity(alices)).to.be.revertedWithCustomError(h, "InvalidProof"); // front-run attempt
      expect(await h.isVerified(mallory.address)).to.equal(false);
      await expect(h.connect(g1).verifyIdentity(alices)).to.emit(h, "IdentityVerified"); // the real owner is unaffected
    });

    it("rejects proofs that do not match their public inputs", async () => {
      const { h, g1, idProof, proof } = await loadFixture(fixture);
      const good = await idProof(g1, N.a);
      const tampered = { ...good, groth16Proof: [good.groth16Proof[0] + 1n, ...good.groth16Proof.slice(1)] };
      await expect(h.connect(g1).verifyIdentity(tampered)).to.be.revertedWithCustomError(h, "InvalidProof");
      await expect(h.connect(g1).verifyIdentity({ ...good, nullifier: N.b })).to.be.revertedWithCustomError(h, "InvalidProof");
      await expect(h.connect(g1).verifyIdentity({ ...good, revealArray: OVER_18 })).to.be.revertedWithCustomError(h, "InvalidProof");
      await expect(h.connect(g1).verifyIdentity(EMPTY)).to.be.revertedWithCustomError(h, "InvalidProof");
      // a proof made for some other app's seed
      const wrongSeed = await proof({ nullifier: N.a, signal: await h.identitySignal(g1.address), seed: SEED + 1n });
      await expect(h.connect(g1).verifyIdentity(wrongSeed)).to.be.revertedWithCustomError(h, "InvalidProof");
      // a proof for another purpose (the claim signal) cannot be used to register an identity
      const wrongUse = await proof({ nullifier: N.a, signal: await h.claimSignal(1, g1.address) });
      await expect(h.connect(g1).verifyIdentity(wrongUse)).to.be.revertedWithCustomError(h, "InvalidProof");
      expect(await h.isVerified(g1.address)).to.equal(false);
    });

    it("requires a fresh proof: not older than 3 hours and not from the future", async () => {
      const { h, g1, idProof } = await loadFixture(fixture);
      const now = await time.latest();
      await expect(h.connect(g1).verifyIdentity(await idProof(g1, N.a, { ts: now - 3 * HOUR - 10 }))).to.be.revertedWithCustomError(h, "StaleProof");
      await expect(h.connect(g1).verifyIdentity(await idProof(g1, N.a, { ts: now + 1000 }))).to.be.revertedWithCustomError(h, "StaleProof");
      await expect(h.connect(g1).verifyIdentity(await idProof(g1, N.a, { ts: now - 3 * HOUR + 600 }))).to.emit(h, "IdentityVerified");
    });

    it("a proof goes stale as time passes", async () => {
      const { h, g1, idProof } = await loadFixture(fixture);
      const p = await idProof(g1, N.a);
      await time.increase(3 * HOUR + 5);
      await expect(h.connect(g1).verifyIdentity(p)).to.be.revertedWithCustomError(h, "StaleProof");
    });

    it("is disabled when the deployment has no verifier, and everything else still works", async () => {
      const { g1, g2, g3, owner, idProof } = await loadFixture(fixture);
      const bare = await (await ethers.getContractFactory("Heirloom")).deploy(ethers.ZeroAddress, SEED);
      for (const s of [owner, g1, g2, g3]) await bare.connect(s).registerEncryptionKey(randomPub());
      await expect(bare.connect(g1).verifyIdentity(await idProof(g1, N.a))).to.be.revertedWithCustomError(bare, "IdentityDisabled");
      const gs = [g1, g2, g3].map((g) => g.address);
      await expect(bare.connect(owner).createVault(gs, 2, 600, true)).to.be.revertedWithCustomError(bare, "IdentityDisabled");
      await expect(bare.connect(owner).createVault(gs, 2, 600, false)).to.emit(bare, "VaultCreated");
    });

    it("rejects an unusable nullifier seed", async () => {
      const F = await ethers.getContractFactory("Heirloom");
      const addr = ethers.ZeroAddress;
      await expect(F.deploy(addr, 0)).to.be.revertedWithCustomError(F, "InvalidSeed");
      await expect(F.deploy(addr, FIELD)).to.be.revertedWithCustomError(F, "InvalidSeed");
      await expect(F.deploy(addr, FIELD - 1n)).to.not.be.reverted;
    });
  });

  describe("requireVerifiedGuardians", () => {
    const guardians = (c) => [c.g1, c.g2, c.g3].map((g) => g.address);

    it("accepts a vault whose guardians are all verified and records the policy", async () => {
      const c = await loadFixture(fixture);
      await c.verify(c.g1, N.a); await c.verify(c.g2, N.b); await c.verify(c.g3, N.c);
      await expect(c.h.connect(c.owner).createVault(guardians(c), 2, 600, true)).to.emit(c.h, "VaultCreated").withArgs(c.owner.address, guardians(c), 2, 600, true);
      expect((await c.h.getVault(c.owner.address)).requireVerifiedGuardians).to.equal(true);
      // each guardian has a distinct nullifier
      const ids = await Promise.all(guardians(c).map((g) => c.h.nullifierOf(g)));
      expect(new Set(ids.map(String)).size).to.equal(3);
    });

    it("rejects a guardian who has not verified, naming them", async () => {
      const c = await loadFixture(fixture);
      await c.verify(c.g1, N.a); await c.verify(c.g2, N.b); // g3 has not
      await expect(c.h.connect(c.owner).createVault(guardians(c), 2, 600, true)).to.be.revertedWithCustomError(c.h, "GuardianNotVerified").withArgs(c.g3.address);
      expect(await c.h.hasVault(c.owner.address)).to.equal(false);
    });

    it("is optional: with the policy off anyone with a key can be a guardian", async () => {
      const c = await loadFixture(fixture);
      await c.h.connect(c.owner).createVault(guardians(c), 2, 600, false);
      expect((await c.h.getVault(c.owner.address)).requireVerifiedGuardians).to.equal(false);
    });

    it("one person cannot fill two guardian seats with two wallets", async () => {
      const c = await loadFixture(fixture);
      await c.verify(c.g1, N.a); await c.verify(c.g3, N.c);
      await expect(c.h.connect(c.g2).verifyIdentity(await c.idProof(c.g2, N.a))).to.be.revertedWithCustomError(c.h, "NullifierAlreadyUsed");
      await expect(c.h.connect(c.owner).createVault(guardians(c), 2, 600, true)).to.be.revertedWithCustomError(c.h, "GuardianNotVerified").withArgs(c.g2.address);
    });

    it("rotateGuardians enforces the policy on the new set and can switch it on or off", async () => {
      const c = await loadFixture(fixture);
      await c.h.connect(c.owner).createVault(guardians(c), 2, 600, false);
      const next = [c.g1, c.g2, c.g4].map((g) => g.address);
      await c.verify(c.g1, N.a); await c.verify(c.g2, N.b);
      await expect(c.h.connect(c.owner).rotateGuardians(next, 2, true)).to.be.revertedWithCustomError(c.h, "GuardianNotVerified").withArgs(c.g4.address);
      await c.verify(c.g4, N.c);
      await expect(c.h.connect(c.owner).rotateGuardians(next, 2, true)).to.emit(c.h, "GuardiansRotated").withArgs(c.owner.address, next, 2, 1, true);
      expect((await c.h.getVault(c.owner.address)).requireVerifiedGuardians).to.equal(true);
      // switching it off lets an unverified guardian in again
      await expect(c.h.connect(c.owner).rotateGuardians(guardians(c), 2, false)).to.emit(c.h, "GuardiansRotated");
      expect((await c.h.getVault(c.owner.address)).requireVerifiedGuardians).to.equal(false);
      // and the policy is checked against the new set, not the old one
      await expect(c.h.connect(c.owner).rotateGuardians(guardians(c), 2, true)).to.be.revertedWithCustomError(c.h, "GuardianNotVerified").withArgs(c.g3.address);
    });
  });

  describe("claims with identity policies", () => {
    async function vaultWithAsset(c, pol, { verifyBen = true } = {}) {
      await c.h.connect(c.owner).createVault([c.g1, c.g2, c.g3].map((g) => g.address), 2, 600, false);
      if (verifyBen) await c.verify(c.ben, N.a);
      return c.h.connect(c.owner).addAsset(c.ben.address, "cid", ethers.id("plain"), shares(3), "0x" + "ee".repeat(40), policy(pol));
    }
    const EVID = ethers.id("evidence");
    const raise = (c, proof, signer) => c.h.connect(signer ?? c.ben).raiseClaim(0, EV.Death, EVID, "ev", proof);
    const claimProof = async (c, who, claimId, o = {}) => c.proof({ nullifier: N.a, signal: await c.h.claimSignal(claimId, who.address), ...o });
    const ageProof = async (c, who, claimId, o = {}) => c.proof({ nullifier: N.a, signal: await c.h.ageSignal(claimId, who.address), reveal: OVER_18, ...o });

    describe("requireBeneficiaryZK", () => {
      it("needs a verified beneficiary when the asset is created", async () => {
        const c = await loadFixture(fixture);
        await expect(vaultWithAsset(c, { requireBeneficiaryZK: true }, { verifyBen: false })).to.be.revertedWithCustomError(c.h, "BeneficiaryNotVerified").withArgs(c.ben.address);
      });

      it("raiseClaim requires a fresh proof by the registered identity, bound to the claim id", async () => {
        const c = await loadFixture(fixture);
        await vaultWithAsset(c, { requireBeneficiaryZK: true });
        await time.increase(601);

        await expect(raise(c, EMPTY)).to.be.revertedWithCustomError(c.h, "NullifierMismatch"); // no proof
        await expect(raise(c, await claimProof(c, c.ben, 1, { nullifier: N.b }))).to.be.revertedWithCustomError(c.h, "NullifierMismatch"); // somebody else's identity
        await expect(raise(c, await claimProof(c, c.ben, 2))).to.be.revertedWithCustomError(c.h, "InvalidProof"); // for a different claim id
        await expect(raise(c, await claimProof(c, c.other, 1))).to.be.revertedWithCustomError(c.h, "InvalidProof"); // for a different person
        await expect(raise(c, await c.proof({ nullifier: N.a, signal: await c.h.ageSignal(1, c.ben.address) }))).to.be.revertedWithCustomError(c.h, "InvalidProof"); // for another purpose
        await expect(raise(c, await claimProof(c, c.ben, 1, { ts: (await time.latest()) - 3 * HOUR - 1 }))).to.be.revertedWithCustomError(c.h, "StaleProof");
        expect(await c.h.claimCount()).to.equal(0);

        await expect(raise(c, await claimProof(c, c.ben, 1))).to.emit(c.h, "ClaimRaised");
        expect(await c.h.claimCount()).to.equal(1);
      });

      it("a proof cannot be replayed for a later claim", async () => {
        const c = await loadFixture(fixture);
        await vaultWithAsset(c, { requireBeneficiaryZK: true });
        await time.increase(601);
        const p = await claimProof(c, c.ben, 1);
        await raise(c, p);
        await c.h.connect(c.owner).cancelClaim(1);
        await time.increase(601);
        await expect(raise(c, p)).to.be.revertedWithCustomError(c.h, "InvalidProof"); // claim #2 needs its own proof
        await expect(raise(c, await claimProof(c, c.ben, 2))).to.emit(c.h, "ClaimRaised");
      });

      it("only the beneficiary can raise a claim, proof or not", async () => {
        const c = await loadFixture(fixture);
        await vaultWithAsset(c, { requireBeneficiaryZK: true });
        await time.increase(601);
        await expect(raise(c, await claimProof(c, c.ben, 1), c.mallory)).to.be.revertedWithCustomError(c.h, "NotBeneficiary");
      });

      it("is optional: without it an empty proof is fine", async () => {
        const c = await loadFixture(fixture);
        await vaultWithAsset(c, {}, { verifyBen: false });
        await time.increase(601);
        await expect(raise(c, EMPTY)).to.emit(c.h, "ClaimRaised");
      });
    });

    describe("requireAge18", () => {
      async function finalizable(c, pol) {
        await vaultWithAsset(c, pol);
        await time.increase(601);
        await raise(c, EMPTY);
        await c.h.connect(c.g1).attest(1);
        await c.h.connect(c.g2).attest(1);
        await time.increase(601);
      }

      it("needs a verified beneficiary when the asset is created", async () => {
        const c = await loadFixture(fixture);
        await expect(vaultWithAsset(c, { requireAge18: true }, { verifyBen: false })).to.be.revertedWithCustomError(c.h, "BeneficiaryNotVerified");
      });

      it("finalize needs a proof of the beneficiary's identity that reveals ageAbove18 = true", async () => {
        const c = await loadFixture(fixture);
        await finalizable(c, { requireAge18: true });

        await expect(c.h.finalizeClaim(1, EMPTY)).to.be.revertedWithCustomError(c.h, "NullifierMismatch");
        await expect(c.h.finalizeClaim(1, await ageProof(c, c.ben, 1, { nullifier: N.b }))).to.be.revertedWithCustomError(c.h, "NullifierMismatch");
        // a genuine proof that did not reveal age (or revealed "not above 18") proves nothing about age
        await expect(c.h.finalizeClaim(1, await ageProof(c, c.ben, 1, { reveal: NONE }))).to.be.revertedWithCustomError(c.h, "AgeNotProven");
        await expect(c.h.finalizeClaim(1, await ageProof(c, c.ben, 1, { reveal: [0, 1, 1, 1] }))).to.be.revertedWithCustomError(c.h, "AgeNotProven");
        await expect(c.h.finalizeClaim(1, await ageProof(c, c.ben, 2))).to.be.revertedWithCustomError(c.h, "InvalidProof"); // another claim
        await expect(c.h.finalizeClaim(1, await ageProof(c, c.ben, 1, { ts: (await time.latest()) - 3 * HOUR - 1 }))).to.be.revertedWithCustomError(c.h, "StaleProof");
        await expect(c.h.finalizeClaim(1, await c.proof({ nullifier: N.a, signal: await c.h.claimSignal(1, c.ben.address), reveal: OVER_18 }))).to.be.revertedWithCustomError(c.h, "InvalidProof"); // wrong purpose
        expect((await c.h.getClaim(1)).status).to.equal(1); // still Raised

        await expect(c.h.finalizeClaim(1, await ageProof(c, c.ben, 1))).to.emit(c.h, "ClaimFinalized");
        expect((await c.h.getClaim(1)).status).to.equal(3);
      });

      it("anyone can relay the beneficiary's proof, but it only ever finalizes that claim", async () => {
        const c = await loadFixture(fixture);
        await finalizable(c, { requireAge18: true });
        await expect(c.h.connect(c.stranger).finalizeClaim(1, await ageProof(c, c.ben, 1))).to.emit(c.h, "ClaimFinalized").withArgs(1, c.stranger.address);
      });

      it("the other finalize rules still apply first", async () => {
        const c = await loadFixture(fixture);
        await vaultWithAsset(c, { requireAge18: true });
        await time.increase(601);
        await raise(c, EMPTY);
        await expect(c.h.finalizeClaim(1, await ageProof(c, c.ben, 1))).to.be.revertedWithCustomError(c.h, "ChallengePeriodNotOver");
        await time.increase(601);
        await expect(c.h.finalizeClaim(1, await ageProof(c, c.ben, 1))).to.be.revertedWithCustomError(c.h, "NotEnoughApprovals");
      });

      it("stores no date of birth or other attribute: only the policy flag and the nullifier exist on-chain", async () => {
        const c = await loadFixture(fixture);
        await finalizable(c, { requireAge18: true });
        await c.h.finalizeClaim(1, await ageProof(c, c.ben, 1));
        const asset = await c.h.getAsset(0);
        expect(asset.policy.requireAge18).to.equal(true);
        const names = c.h.interface.getFunction("getAsset").outputs[0].components.map((x) => x.name).concat(c.h.interface.getFunction("getClaim").outputs[0].components.map((x) => x.name));
        expect(names.filter((n) => /^(dob|dateofbirth|birthdate|age|ageabove18|gender|pincode|state)$/i.test(n))).to.deep.equal([]);
        expect(await c.h.nullifierOf(c.ben.address)).to.equal(N.a);
      });
    });

    it("both policies together", async () => {
      const c = await loadFixture(fixture);
      await vaultWithAsset(c, { requireBeneficiaryZK: true, requireAge18: true });
      await time.increase(601);
      await raise(c, await claimProof(c, c.ben, 1));
      await c.h.connect(c.g1).attest(1);
      await c.h.connect(c.g2).attest(1);
      await time.increase(601);
      await expect(c.h.finalizeClaim(1, await ageProof(c, c.ben, 1))).to.emit(c.h, "ClaimFinalized");
    });
  });
});
