const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const MIN = 300;
const DAY = 86400;
const EV = { Death: 0, Incapacity: 1, Any: 2 };
const ST = { None: 0, Raised: 1, Cancelled: 2, Finalized: 3, Rejected: 4 };
const randomPub = () => "0x04" + ethers.hexlify(ethers.randomBytes(64)).slice(2);
const shares = (n) => Array.from({ length: n }, (_, i) => "0x" + (i + 1).toString(16).padStart(2, "0").repeat(24));
const WRAPPED = "0x" + "ee".repeat(40);
const EVIDENCE = ethers.id("evidence");
const policy = (o = {}) => ({
  requiredApprovals: 2,
  challengePeriod: 600,
  minInactivity: 600,
  unlockAfter: 0,
  evidenceType: EV.Any,
  attestationDeadline: DAY,
  ...o,
});

async function deployFixture() {
  const [owner, g1, g2, g3, g4, g5, ben, stranger, noKey] = await ethers.getSigners();
  const h = await (await ethers.getContractFactory("Heirloom")).deploy();
  for (const s of [owner, g1, g2, g3, g4, g5, ben]) await h.connect(s).registerEncryptionKey(randomPub());
  return { h, owner, g1, g2, g3, g4, g5, ben, stranger, noKey };
}

/** Vault with g1..g3 (threshold 2, heartbeat every 10 min) and one asset (id 0) for `ben`. */
async function assetFixture() {
  const ctx = await deployFixture();
  const { h, owner, g1, g2, g3, ben } = ctx;
  await h.connect(owner).createVault([g1, g2, g3].map((g) => g.address), 2, 600);
  await h.connect(owner).addAsset(ben.address, "cid-1", ethers.id("plain"), shares(3), WRAPPED, policy());
  return ctx;
}

/** Waits out the inactivity requirement and raises claim #1 as the beneficiary. */
async function raised(ctx, type = EV.Death) {
  await time.increase(601);
  await ctx.h.connect(ctx.ben).raiseClaim(0, type, EVIDENCE, "ev-cid");
  return 1;
}

async function finalizable(ctx) {
  const id = await raised(ctx);
  await ctx.h.connect(ctx.g1).attest(id);
  await ctx.h.connect(ctx.g2).attest(id);
  await time.increase(601);
  return id;
}

describe("Heirloom", () => {
  describe("encryption keys", () => {
    it("registers uncompressed and compressed keys and exposes them", async () => {
      const { h, stranger } = await loadFixture(deployFixture);
      const key = randomPub();
      await expect(h.connect(stranger).registerEncryptionKey(key)).to.emit(h, "EncryptionKeyRegistered").withArgs(stranger.address, key);
      expect(await h.getEncryptionKey(stranger.address)).to.equal(key);
      expect(await h.hasEncryptionKey(stranger.address)).to.equal(true);
      const compressed = "0x02" + "11".repeat(32);
      await h.connect(stranger).registerEncryptionKey(compressed);
      expect(await h.getEncryptionKey(stranger.address)).to.equal(compressed);
    });

    it("rejects malformed keys", async () => {
      const { h, stranger } = await loadFixture(deployFixture);
      for (const bad of ["0x", "0x04" + "11".repeat(10), "0x05" + "11".repeat(64), "0x04" + "11".repeat(32), "0x02" + "11".repeat(64)])
        await expect(h.connect(stranger).registerEncryptionKey(bad)).to.be.revertedWithCustomError(h, "InvalidEncryptionKey");
    });
  });

  describe("vault", () => {
    it("creates a vault with 3–7 registered guardians", async () => {
      const { h, owner, g1, g2, g3, g4, g5 } = await loadFixture(deployFixture);
      const gs = [g1, g2, g3, g4, g5].map((g) => g.address);
      await expect(h.connect(owner).createVault(gs, 3, 900)).to.emit(h, "VaultCreated").withArgs(owner.address, gs, 3, 900);
      const v = await h.getVault(owner.address);
      expect(v.owner).to.equal(owner.address);
      expect([...v.guardians]).to.deep.equal(gs);
      expect(v.threshold).to.equal(3);
      expect(v.heartbeatInterval).to.equal(900);
      expect(v.frozen).to.equal(false);
      expect(await h.hasVault(owner.address)).to.equal(true);
    });

    it("validates guardians, threshold, interval and keys", async () => {
      const { h, owner, g1, g2, g3, g4, g5, stranger } = await loadFixture(deployFixture);
      const a = (...s) => s.map((x) => x.address);
      await expect(h.connect(owner).createVault(a(g1, g2), 2, 600)).to.be.revertedWithCustomError(h, "InvalidGuardians");
      const eight = [g1, g2, g3, g4, g5, stranger, owner, owner].map((x) => x.address);
      await expect(h.connect(owner).createVault(eight, 2, 600)).to.be.revertedWithCustomError(h, "InvalidGuardians");
      await expect(h.connect(owner).createVault(a(g1, g2, g2), 2, 600)).to.be.revertedWithCustomError(h, "InvalidGuardians");
      await expect(h.connect(owner).createVault(a(g1, g2, owner), 2, 600)).to.be.revertedWithCustomError(h, "InvalidGuardians");
      await expect(h.connect(owner).createVault([g1.address, g2.address, ethers.ZeroAddress], 2, 600)).to.be.revertedWithCustomError(h, "InvalidGuardians");
      await expect(h.connect(owner).createVault(a(g1, g2, stranger), 2, 600))
        .to.be.revertedWithCustomError(h, "NoEncryptionKey").withArgs(stranger.address);
      await expect(h.connect(owner).createVault(a(g1, g2, g3), 1, 600)).to.be.revertedWithCustomError(h, "InvalidThreshold");
      await expect(h.connect(owner).createVault(a(g1, g2, g3), 4, 600)).to.be.revertedWithCustomError(h, "InvalidThreshold");
      await expect(h.connect(owner).createVault(a(g1, g2, g3), 2, MIN - 1)).to.be.revertedWithCustomError(h, "PeriodTooShort");
      await expect(h.connect(stranger).createVault(a(g1, g2, g3), 2, 600)).to.be.revertedWithCustomError(h, "NoEncryptionKey");
      await h.connect(owner).createVault(a(g1, g2, g3), 2, MIN);
      await expect(h.connect(owner).createVault(a(g1, g2, g3), 2, 600)).to.be.revertedWithCustomError(h, "VaultExists");
    });

    it("heartbeat updates lastHeartbeat and emits", async () => {
      const { h, owner } = await loadFixture(assetFixture);
      await time.increase(1000);
      const tx = await h.connect(owner).heartbeat();
      const ts = await time.latest();
      await expect(tx).to.emit(h, "Heartbeat").withArgs(owner.address, ts);
      expect((await h.getVault(owner.address)).lastHeartbeat).to.equal(ts);
    });

    it("panicFreeze / unfreeze toggle state and emit", async () => {
      const { h, owner } = await loadFixture(assetFixture);
      await expect(h.connect(owner).unfreeze()).to.be.revertedWithCustomError(h, "VaultNotFrozen");
      await expect(h.connect(owner).panicFreeze()).to.emit(h, "PanicFrozen").withArgs(owner.address);
      expect((await h.getVault(owner.address)).frozen).to.equal(true);
      await expect(h.connect(owner).panicFreeze()).to.be.revertedWithCustomError(h, "VaultFrozen");
      await expect(h.connect(owner).unfreeze()).to.emit(h, "VaultUnfrozen").and.to.emit(h, "Heartbeat");
      expect((await h.getVault(owner.address)).frozen).to.equal(false);
    });
  });

  describe("assets", () => {
    it("stores asset, wrapped key, policy and indexes", async () => {
      const { h, owner, ben } = await loadFixture(assetFixture);
      const a = await h.getAsset(0);
      expect(a.owner).to.equal(owner.address);
      expect(a.beneficiary).to.equal(ben.address);
      expect(a.storageId).to.equal("cid-1");
      expect(a.contentHash).to.equal(ethers.id("plain"));
      expect([...a.encShares]).to.deep.equal(shares(3));
      expect(a.ownerWrappedKey).to.equal(WRAPPED);
      expect(a.policy.requiredApprovals).to.equal(2);
      expect(a.policy.evidenceType).to.equal(EV.Any);
      expect(a.released).to.equal(false);
      expect(await h.assetCount()).to.equal(1);
      expect([...(await h.assetsByOwner(owner.address))]).to.deep.equal([0n]);
      expect([...(await h.assetsByBeneficiary(ben.address))]).to.deep.equal([0n]);
    });

    it("emits AssetAdded", async () => {
      const { h, owner, g1, g2, g3, ben } = await loadFixture(deployFixture);
      await h.connect(owner).createVault([g1, g2, g3].map((g) => g.address), 2, 600);
      await expect(h.connect(owner).addAsset(ben.address, "cid", ethers.id("x"), shares(3), WRAPPED, policy()))
        .to.emit(h, "AssetAdded").withArgs(0, owner.address, ben.address, "cid", ethers.id("x"));
    });

    it("validates inputs", async () => {
      const { h, owner, g1, g2, g3, ben, stranger, noKey } = await loadFixture(deployFixture);
      const add = (o = {}) => {
        const p = { b: ben.address, sid: "cid", ch: ethers.id("x"), sh: shares(3), w: WRAPPED, pol: policy(), ...o };
        return h.connect(o.from ?? owner).addAsset(p.b, p.sid, p.ch, p.sh, p.w, p.pol);
      };
      await expect(add()).to.be.revertedWithCustomError(h, "NoVault");
      await h.connect(owner).createVault([g1, g2, g3].map((g) => g.address), 2, 600);
      await expect(add({ b: ethers.ZeroAddress })).to.be.revertedWithCustomError(h, "InvalidBeneficiary");
      await expect(add({ b: owner.address })).to.be.revertedWithCustomError(h, "InvalidBeneficiary");
      await expect(add({ b: noKey.address })).to.be.revertedWithCustomError(h, "NoEncryptionKey");
      await expect(add({ sid: "" })).to.be.revertedWithCustomError(h, "EmptyField");
      await expect(add({ ch: ethers.ZeroHash })).to.be.revertedWithCustomError(h, "EmptyField");
      await expect(add({ w: "0x" })).to.be.revertedWithCustomError(h, "EmptyField");
      await expect(add({ sh: shares(2) })).to.be.revertedWithCustomError(h, "InvalidShares");
      await expect(add({ sh: ["0x01", "0x", "0x03"] })).to.be.revertedWithCustomError(h, "InvalidShares");
      await expect(add({ pol: policy({ challengePeriod: MIN - 1 }) })).to.be.revertedWithCustomError(h, "PeriodTooShort");
      await expect(add({ pol: policy({ minInactivity: MIN - 1 }) })).to.be.revertedWithCustomError(h, "PeriodTooShort");
      await expect(add({ pol: policy({ attestationDeadline: MIN - 1 }) })).to.be.revertedWithCustomError(h, "PeriodTooShort");
      await expect(add({ pol: policy({ requiredApprovals: 1 }) })).to.be.revertedWithCustomError(h, "InvalidPolicy");
      await expect(add({ pol: policy({ requiredApprovals: 4 }) })).to.be.revertedWithCustomError(h, "InvalidPolicy");
      await expect(add({ pol: policy({ unlockAfter: (await time.latest()) - 1 }) })).to.be.revertedWithCustomError(h, "InvalidPolicy");
      await expect(add({ pol: policy({ challengePeriod: MIN, minInactivity: MIN, attestationDeadline: MIN }) })).to.not.be.reverted;
      void stranger;
    });
  });

  describe("claim lifecycle", () => {
    it("happy path: raise, attest, challenge period, finalize, share release", async () => {
      const ctx = await loadFixture(assetFixture);
      const { h, g1, g2, ben } = ctx;
      await time.increase(601);
      await expect(h.connect(ben).raiseClaim(0, EV.Death, EVIDENCE, "ev-cid"))
        .to.emit(h, "ClaimRaised").withArgs(1, 0, ben.address, EV.Death, EVIDENCE, "ev-cid");
      let c = await h.getClaim(1);
      expect(c.status).to.equal(ST.Raised);
      expect(c.claimant).to.equal(ben.address);
      expect(c.evidenceHash).to.equal(EVIDENCE);
      expect(c.evidenceStorageId).to.equal("ev-cid");
      expect((await h.getAsset(0)).activeClaim).to.equal(1);

      await expect(h.connect(g1).attest(1)).to.emit(h, "Attested").withArgs(1, g1.address, 1);
      await expect(h.connect(ben).finalizeClaim(1)).to.be.revertedWithCustomError(h, "ChallengePeriodNotOver");
      await h.connect(g2).attest(1);
      await expect(h.connect(ben).finalizeClaim(1)).to.be.revertedWithCustomError(h, "ChallengePeriodNotOver");
      await time.increase(601);
      await expect(h.connect(ben).finalizeClaim(1)).to.emit(h, "ClaimFinalized").withArgs(1, ben.address);
      c = await h.getClaim(1);
      expect(c.status).to.equal(ST.Finalized);
      expect(c.approvals).to.equal(2);
      expect((await h.getAsset(0)).released).to.equal(true);

      await expect(h.connect(g1).submitShare(1, "0xaa01")).to.emit(h, "ShareReleased").withArgs(1, 0, g1.address);
      await h.connect(g2).submitShare(1, "0xbb02");
      expect([...(await h.getReleasedShares(1))]).to.deep.equal(["0xaa01", "0xbb02", "0x"]);
      await expect(h.connect(ctx.ben).raiseClaim(0, EV.Death, EVIDENCE, "x")).to.be.revertedWithCustomError(h, "AssetAlreadyReleased");
    });

    it("raiseClaim: only beneficiary, after inactivity, matching evidence", async () => {
      const { h, owner, g1, ben, stranger } = await loadFixture(assetFixture);
      await expect(h.connect(ben).raiseClaim(0, EV.Death, EVIDENCE, "e")).to.be.revertedWithCustomError(h, "NotInactiveLongEnough");
      await time.increase(601);
      await expect(h.connect(stranger).raiseClaim(0, EV.Death, EVIDENCE, "e")).to.be.revertedWithCustomError(h, "NotBeneficiary");
      await expect(h.connect(owner).raiseClaim(0, EV.Death, EVIDENCE, "e")).to.be.revertedWithCustomError(h, "NotBeneficiary");
      await expect(h.connect(g1).raiseClaim(0, EV.Death, EVIDENCE, "e")).to.be.revertedWithCustomError(h, "NotBeneficiary");
      await expect(h.connect(ben).raiseClaim(9, EV.Death, EVIDENCE, "e")).to.be.revertedWithCustomError(h, "NoSuchAsset");
      await expect(h.connect(ben).raiseClaim(0, EV.Any, EVIDENCE, "e")).to.be.revertedWithCustomError(h, "EvidenceTypeMismatch");
      await expect(h.connect(ben).raiseClaim(0, EV.Death, ethers.ZeroHash, "e")).to.be.revertedWithCustomError(h, "EmptyField");
      await expect(h.connect(ben).raiseClaim(0, EV.Death, EVIDENCE, "")).to.be.revertedWithCustomError(h, "EmptyField");
    });

    it("enforces the asset's evidence type", async () => {
      const ctx = await loadFixture(deployFixture);
      const { h, owner, g1, g2, g3, ben } = ctx;
      await h.connect(owner).createVault([g1, g2, g3].map((g) => g.address), 2, 600);
      await h.connect(owner).addAsset(ben.address, "cid", ethers.id("x"), shares(3), WRAPPED, policy({ evidenceType: EV.Death }));
      await time.increase(601);
      await expect(h.connect(ben).raiseClaim(0, EV.Incapacity, EVIDENCE, "e")).to.be.revertedWithCustomError(h, "EvidenceTypeMismatch");
      await expect(h.connect(ben).raiseClaim(0, EV.Death, EVIDENCE, "e")).to.not.be.reverted;
    });

    it("inactivity requirement is the larger of policy minInactivity and heartbeatInterval", async () => {
      const { h, owner, g1, g2, g3, ben } = await loadFixture(deployFixture);
      await h.connect(owner).createVault([g1, g2, g3].map((g) => g.address), 2, 3600);
      await h.connect(owner).addAsset(ben.address, "cid", ethers.id("x"), shares(3), WRAPPED, policy({ minInactivity: 600 }));
      await time.increase(1000);
      await expect(h.connect(ben).raiseClaim(0, EV.Death, EVIDENCE, "e")).to.be.revertedWithCustomError(h, "NotInactiveLongEnough");
      await time.increase(2700);
      await expect(h.connect(ben).raiseClaim(0, EV.Death, EVIDENCE, "e")).to.not.be.reverted;
    });

    it("blocks a second live claim on the same asset", async () => {
      const ctx = await loadFixture(assetFixture);
      await raised(ctx);
      await expect(ctx.h.connect(ctx.ben).raiseClaim(0, EV.Death, EVIDENCE, "e")).to.be.revertedWithCustomError(ctx.h, "ClaimAlreadyActive");
    });

    it("attest: guardians only, once, with unknown claims rejected", async () => {
      const ctx = await loadFixture(assetFixture);
      const { h, g1, g4, stranger, ben, owner } = ctx;
      await expect(h.connect(g1).attest(1)).to.be.revertedWithCustomError(h, "NoSuchClaim");
      await expect(h.connect(g1).attest(0)).to.be.revertedWithCustomError(h, "NoSuchClaim");
      await raised(ctx);
      for (const s of [stranger, ben, owner, g4]) await expect(h.connect(s).attest(1)).to.be.revertedWithCustomError(h, "NotGuardian");
      await h.connect(g1).attest(1);
      await expect(h.connect(g1).attest(1)).to.be.revertedWithCustomError(h, "AlreadyResponded");
      await expect(h.connect(g1).reject(1, ethers.id("r"))).to.be.revertedWithCustomError(h, "AlreadyResponded");
    });

    it("finalize fails without enough approvals", async () => {
      const ctx = await loadFixture(assetFixture);
      await raised(ctx);
      await ctx.h.connect(ctx.g1).attest(1);
      await time.increase(601);
      await expect(ctx.h.finalizeClaim(1)).to.be.revertedWithCustomError(ctx.h, "NotEnoughApprovals");
    });

    it("finalize is permissionless but only once", async () => {
      const ctx = await loadFixture(assetFixture);
      const id = await finalizable(ctx);
      await expect(ctx.h.connect(ctx.stranger).finalizeClaim(id)).to.emit(ctx.h, "ClaimFinalized");
      await expect(ctx.h.finalizeClaim(id)).to.be.revertedWithCustomError(ctx.h, "ClaimNotRaised");
    });
  });

  describe("cancel", () => {
    it("owner cancels; claim is dead; a new claim can be raised", async () => {
      const ctx = await loadFixture(assetFixture);
      const { h, owner, g1, ben } = ctx;
      await raised(ctx);
      await h.connect(g1).attest(1);
      await expect(h.connect(owner).cancelClaim(1)).to.emit(h, "ClaimCancelled").withArgs(1, owner.address);
      expect((await h.getClaim(1)).status).to.equal(ST.Cancelled);
      await expect(h.connect(ctx.g2).attest(1)).to.be.revertedWithCustomError(h, "ClaimNotRaised");
      await time.increase(601);
      await expect(h.finalizeClaim(1)).to.be.revertedWithCustomError(h, "ClaimNotRaised");
      await expect(h.connect(owner).cancelClaim(1)).to.be.revertedWithCustomError(h, "ClaimNotRaised");
      await expect(h.connect(ben).raiseClaim(0, EV.Death, EVIDENCE, "e2")).to.emit(h, "ClaimRaised");
    });
  });

  describe("heartbeat invalidation", () => {
    it("a heartbeat after raisedAt invalidates the claim", async () => {
      const ctx = await loadFixture(assetFixture);
      const { h, owner, g1, g2, g3, ben } = ctx;
      await raised(ctx);
      await h.connect(g1).attest(1);
      await h.connect(g2).attest(1);
      await time.increase(601);
      expect(await h.isClaimInvalidated(1)).to.equal(false);
      await h.connect(owner).heartbeat();
      expect(await h.isClaimInvalidated(1)).to.equal(true);
      await expect(h.finalizeClaim(1)).to.be.revertedWithCustomError(h, "ClaimInvalidatedByHeartbeat");
      await expect(h.connect(g3).attest(1)).to.be.revertedWithCustomError(h, "ClaimInvalidatedByHeartbeat");
      await expect(h.connect(g3).reject(1, ethers.id("r"))).to.be.revertedWithCustomError(h, "ClaimInvalidatedByHeartbeat");
      await expect(h.connect(g3).flagFraud(1)).to.be.revertedWithCustomError(h, "ClaimInvalidatedByHeartbeat");
      await expect(h.connect(ben).raiseClaim(0, EV.Death, EVIDENCE, "e")).to.be.revertedWithCustomError(h, "NotInactiveLongEnough");
      await time.increase(601);
      await expect(h.connect(ben).raiseClaim(0, EV.Death, EVIDENCE, "e")).to.emit(h, "ClaimRaised"); // replaces the stale claim
    });
  });

  describe("fraud flag", () => {
    it("freezes the claim until the owner cancels it", async () => {
      const ctx = await loadFixture(assetFixture);
      const { h, owner, g1, g2, g3, ben, stranger } = ctx;
      await raised(ctx);
      await h.connect(g1).attest(1);
      await h.connect(g2).attest(1);
      await expect(h.connect(stranger).flagFraud(1)).to.be.revertedWithCustomError(h, "NotGuardian");
      await expect(h.connect(g3).flagFraud(1)).to.emit(h, "FraudFlagged").withArgs(1, g3.address);
      expect((await h.getClaim(1)).flagged).to.equal(true);
      expect((await h.getResponse(1, g3.address)).flaggedFraud).to.equal(true);
      await expect(h.connect(g3).flagFraud(1)).to.be.revertedWithCustomError(h, "AlreadyFlagged");
      await time.increase(DAY + 1); // even after every deadline
      await expect(h.finalizeClaim(1)).to.be.revertedWithCustomError(h, "ClaimFlaggedFraud");
      await expect(h.connect(g3).attest(1)).to.be.revertedWithCustomError(h, "ClaimFlaggedFraud");
      await expect(h.connect(ben).raiseClaim(0, EV.Death, EVIDENCE, "e")).to.be.revertedWithCustomError(h, "ClaimAlreadyActive");
      await h.connect(owner).cancelClaim(1);
      await expect(h.connect(ben).raiseClaim(0, EV.Death, EVIDENCE, "e")).to.emit(h, "ClaimRaised");
    });

    it("an attesting guardian may still flag fraud afterwards", async () => {
      const ctx = await loadFixture(assetFixture);
      await raised(ctx);
      await ctx.h.connect(ctx.g1).attest(1);
      await expect(ctx.h.connect(ctx.g1).flagFraud(1)).to.emit(ctx.h, "FraudFlagged");
    });
  });

  describe("freeze", () => {
    it("blocks raising, attesting and finalizing; unfreeze invalidates open claims", async () => {
      const ctx = await loadFixture(assetFixture);
      const { h, owner, g1, g2, g3, ben } = ctx;
      await time.increase(601);
      await h.connect(owner).panicFreeze();
      await expect(h.connect(ben).raiseClaim(0, EV.Death, EVIDENCE, "e")).to.be.revertedWithCustomError(h, "VaultFrozen");
      await h.connect(owner).unfreeze();
      await time.increase(601);
      await h.connect(ben).raiseClaim(0, EV.Death, EVIDENCE, "e");
      await h.connect(g1).attest(1);
      await h.connect(g2).attest(1);
      await time.increase(601);
      await h.connect(owner).panicFreeze();
      await expect(h.finalizeClaim(1)).to.be.revertedWithCustomError(h, "VaultFrozen");
      await expect(h.connect(g3).attest(1)).to.be.revertedWithCustomError(h, "VaultFrozen");
      await expect(h.connect(g3).reject(1, ethers.id("r"))).to.not.be.reverted; // conservative actions stay open
      await h.connect(owner).unfreeze();
      expect(await h.isClaimInvalidated(1)).to.equal(true);
      await expect(h.finalizeClaim(1)).to.be.revertedWithCustomError(h, "ClaimInvalidatedByHeartbeat");
    });
  });

  describe("unlockAfter", () => {
    it("blocks finalize until the time lock passes", async () => {
      const { h, owner, g1, g2, g3, ben } = await loadFixture(deployFixture);
      await h.connect(owner).createVault([g1, g2, g3].map((g) => g.address), 2, 600);
      const unlock = (await time.latest()) + 5 * DAY;
      await h.connect(owner).addAsset(ben.address, "cid", ethers.id("x"), shares(3), WRAPPED, policy({ unlockAfter: unlock }));
      await time.increase(601);
      await h.connect(ben).raiseClaim(0, EV.Death, EVIDENCE, "e");
      await h.connect(g1).attest(1);
      await h.connect(g2).attest(1);
      await time.increase(601);
      await expect(h.finalizeClaim(1)).to.be.revertedWithCustomError(h, "NotYetUnlocked");
      await time.increaseTo(unlock);
      await expect(h.finalizeClaim(1)).to.emit(h, "ClaimFinalized");
    });
  });

  describe("rejected claim", () => {
    it("is terminal once the threshold becomes unreachable", async () => {
      const ctx = await loadFixture(assetFixture);
      const { h, g1, g2, g3, ben } = ctx;
      await raised(ctx);
      await expect(h.connect(g1).reject(1, ethers.id("not dead"))).to.emit(h, "ClaimRejectedByGuardian").withArgs(1, g1.address, ethers.id("not dead"), 1);
      expect((await h.getClaim(1)).status).to.equal(ST.Raised); // 2 of 3 can still approve
      expect((await h.getResponse(1, g1.address)).attestation).to.equal(2);
      await expect(h.connect(g2).reject(1, ethers.id("fake"))).to.emit(h, "ClaimRejected").withArgs(1);
      expect((await h.getClaim(1)).status).to.equal(ST.Rejected);
      await expect(h.connect(g3).attest(1)).to.be.revertedWithCustomError(h, "ClaimNotRaised");
      await time.increase(DAY + 1);
      await expect(h.finalizeClaim(1)).to.be.revertedWithCustomError(h, "ClaimNotRaised");
      await expect(h.connect(ben).raiseClaim(0, EV.Death, EVIDENCE, "e2")).to.emit(h, "ClaimRaised");
    });

    it("one rejection plus one approval still cannot finalize before the deadline", async () => {
      const ctx = await loadFixture(assetFixture);
      await raised(ctx);
      await ctx.h.connect(ctx.g1).reject(1, ethers.id("r"));
      await ctx.h.connect(ctx.g2).attest(1);
      await time.increase(601);
      await expect(ctx.h.finalizeClaim(1)).to.be.revertedWithCustomError(ctx.h, "NotEnoughApprovals");
    });
  });

  describe("unresponsive guardian", () => {
    it("after attestationDeadline the threshold is enough", async () => {
      const { h, owner, g1, g2, g3, ben } = await loadFixture(deployFixture);
      await h.connect(owner).createVault([g1, g2, g3].map((g) => g.address), 2, 600);
      await h.connect(owner).addAsset(ben.address, "cid", ethers.id("x"), shares(3), WRAPPED, policy({ requiredApprovals: 3, attestationDeadline: 3600 }));
      await time.increase(601);
      await h.connect(ben).raiseClaim(0, EV.Death, EVIDENCE, "e");
      await h.connect(g1).attest(1);
      await h.connect(g2).attest(1); // g3 never answers
      await time.increase(700);
      await expect(h.finalizeClaim(1)).to.be.revertedWithCustomError(h, "NotEnoughApprovals");
      await time.increase(3600);
      await expect(h.finalizeClaim(1)).to.emit(h, "ClaimFinalized");
    });

    it("does not relax below the threshold", async () => {
      const { h, owner, g1, g2, g3, ben } = await loadFixture(deployFixture);
      await h.connect(owner).createVault([g1, g2, g3].map((g) => g.address), 2, 600);
      await h.connect(owner).addAsset(ben.address, "cid", ethers.id("x"), shares(3), WRAPPED, policy({ requiredApprovals: 3, attestationDeadline: 3600 }));
      await time.increase(601);
      await h.connect(ben).raiseClaim(0, EV.Death, EVIDENCE, "e");
      await h.connect(g1).attest(1);
      await time.increase(4000);
      await expect(h.finalizeClaim(1)).to.be.revertedWithCustomError(h, "NotEnoughApprovals");
    });
  });

  describe("shares", () => {
    it("submitShare: only guardians, only after finalize, once, non-empty", async () => {
      const ctx = await loadFixture(assetFixture);
      const { h, g1, g3, g4, ben, owner, stranger } = ctx;
      await raised(ctx);
      await expect(h.connect(g1).submitShare(1, "0x01")).to.be.revertedWithCustomError(h, "ClaimNotFinalized");
      await h.connect(g1).attest(1);
      await h.connect(ctx.g2).attest(1);
      await time.increase(601);
      await h.finalizeClaim(1);
      for (const s of [stranger, ben, owner, g4]) await expect(h.connect(s).submitShare(1, "0x01")).to.be.revertedWithCustomError(h, "NotGuardian");
      await expect(h.connect(g1).submitShare(1, "0x")).to.be.revertedWithCustomError(h, "EmptyField");
      await h.connect(g1).submitShare(1, "0x01");
      await expect(h.connect(g1).submitShare(1, "0x02")).to.be.revertedWithCustomError(h, "ShareAlreadyReleased");
      await expect(h.connect(g3).submitShare(1, "0x03")).to.emit(h, "ShareReleased").withArgs(1, 2, g3.address); // non-attesting guardians may release
      await expect(h.connect(g1).submitShare(2, "0x01")).to.be.revertedWithCustomError(h, "NoSuchClaim");
    });
  });

  describe("rotateGuardians / updateAssetShares", () => {
    it("rotation invalidates open claims and requires re-sharing", async () => {
      const ctx = await loadFixture(assetFixture);
      const { h, owner, g1, g2, g3, g4, g5, ben } = ctx;
      await raised(ctx);
      const next = [g3, g4, g5].map((g) => g.address);
      await expect(h.connect(owner).rotateGuardians(next, 2))
        .to.emit(h, "GuardiansRotated").withArgs(owner.address, next, 2, 1).and.to.emit(h, "Heartbeat");
      expect((await h.getVault(owner.address)).epoch).to.equal(1);
      expect(await h.isClaimInvalidated(1)).to.equal(true);
      await expect(h.connect(g1).attest(1)).to.be.revertedWithCustomError(h, "ClaimInvalidatedByHeartbeat");

      await time.increase(601);
      await expect(h.connect(ben).raiseClaim(0, EV.Death, EVIDENCE, "e")).to.be.revertedWithCustomError(h, "AssetSharesStale");
      await expect(h.connect(owner).updateAssetShares(0, shares(2), WRAPPED)).to.be.revertedWithCustomError(h, "InvalidShares");
      await expect(h.connect(owner).updateAssetShares(0, shares(3), "0x")).to.be.revertedWithCustomError(h, "EmptyField");
      await expect(h.connect(owner).updateAssetShares(0, shares(3), WRAPPED)).to.emit(h, "AssetSharesUpdated").withArgs(0, owner.address, 1);
      await time.increase(601);
      await h.connect(ben).raiseClaim(0, EV.Death, EVIDENCE, "e");
      // the new claim uses the new guardians; the removed ones have no say
      await expect(h.connect(g1).attest(2)).to.be.revertedWithCustomError(h, "NotGuardian");
      await expect(h.connect(g2).attest(2)).to.be.revertedWithCustomError(h, "NotGuardian");
      await expect(h.connect(g4).attest(2)).to.emit(h, "Attested");
      expect([...(await h.claimsByGuardian(g4.address))]).to.deep.equal([2n]);
      expect([...(await h.claimsByGuardian(g1.address))]).to.deep.equal([1n]);
    });

    it("rotation validates the new set", async () => {
      const { h, owner, g1, g2, stranger } = await loadFixture(assetFixture);
      await expect(h.connect(owner).rotateGuardians([g1.address, g2.address], 2)).to.be.revertedWithCustomError(h, "InvalidGuardians");
      await expect(h.connect(owner).rotateGuardians([g1.address, g2.address, stranger.address], 2)).to.be.revertedWithCustomError(h, "NoEncryptionKey");
    });

    it("updateAssetShares is not allowed after release", async () => {
      const ctx = await loadFixture(assetFixture);
      const id = await finalizable(ctx);
      await ctx.h.finalizeClaim(id);
      await expect(ctx.h.connect(ctx.owner).updateAssetShares(0, shares(3), WRAPPED)).to.be.revertedWithCustomError(ctx.h, "AssetAlreadyReleased");
    });
  });

  describe("views", () => {
    it("index helpers", async () => {
      const ctx = await loadFixture(assetFixture);
      const { h, g1, g2, g3, g4, owner, ben } = ctx;
      await raised(ctx);
      for (const g of [g1, g2, g3]) expect([...(await h.claimsByGuardian(g.address))]).to.deep.equal([1n]);
      expect([...(await h.claimsByGuardian(g4.address))]).to.deep.equal([]);
      expect([...(await h.assetsByOwner(ben.address))]).to.deep.equal([]);
      expect([...(await h.assetsByBeneficiary(owner.address))]).to.deep.equal([]);
      expect(await h.claimCount()).to.equal(1);
      expect([...(await h.getClaim(1)).guardians]).to.deep.equal([g1, g2, g3].map((g) => g.address));
      await expect(h.getAsset(5)).to.be.revertedWithCustomError(h, "NoSuchAsset");
      await expect(h.getClaim(0)).to.be.revertedWithCustomError(h, "NoSuchClaim");
    });
  });

  describe("access control", () => {
    it("owner-only functions require a vault / ownership", async () => {
      const ctx = await loadFixture(assetFixture);
      const { h, stranger, g1, ben } = ctx;
      const gs = [ctx.g1, ctx.g2, ctx.g3].map((g) => g.address);
      for (const who of [stranger, g1, ben]) {
        const c = h.connect(who);
        await expect(c.heartbeat()).to.be.revertedWithCustomError(h, "NoVault");
        await expect(c.panicFreeze()).to.be.revertedWithCustomError(h, "NoVault");
        await expect(c.unfreeze()).to.be.revertedWithCustomError(h, "NoVault");
        await expect(c.rotateGuardians(gs, 2)).to.be.revertedWithCustomError(h, "NoVault");
        await expect(c.addAsset(ben.address, "c", ethers.id("x"), shares(3), WRAPPED, policy())).to.be.revertedWithCustomError(h, "NoVault");
        await expect(c.updateAssetShares(0, shares(3), WRAPPED)).to.be.revertedWithCustomError(h, "NoVault");
      }
    });

    it("another vault owner cannot touch someone else's asset or claim", async () => {
      const ctx = await loadFixture(assetFixture);
      const { h, g4, g1, g2, g3 } = ctx;
      await h.connect(g4).registerEncryptionKey(randomPub());
      await h.connect(ctx.g5).registerEncryptionKey(randomPub());
      await h.connect(g4).createVault([g1, g2, g3].map((g) => g.address), 2, 600);
      await expect(h.connect(g4).updateAssetShares(0, shares(3), WRAPPED)).to.be.revertedWithCustomError(h, "NotOwner");
      await raised(ctx);
      await expect(h.connect(g4).cancelClaim(1)).to.be.revertedWithCustomError(h, "NotOwner");
      await expect(h.connect(ctx.stranger).cancelClaim(1)).to.be.revertedWithCustomError(h, "NotOwner");
      await expect(h.connect(ctx.ben).cancelClaim(1)).to.be.revertedWithCustomError(h, "NotOwner");
    });

    it("guardian-only functions reject everyone else", async () => {
      const ctx = await loadFixture(assetFixture);
      const { h, owner, stranger, ben } = ctx;
      await raised(ctx);
      for (const who of [owner, stranger, ben]) {
        await expect(h.connect(who).attest(1)).to.be.revertedWithCustomError(h, "NotGuardian");
        await expect(h.connect(who).reject(1, ethers.id("r"))).to.be.revertedWithCustomError(h, "NotGuardian");
        await expect(h.connect(who).flagFraud(1)).to.be.revertedWithCustomError(h, "NotGuardian");
      }
    });
  });
});
