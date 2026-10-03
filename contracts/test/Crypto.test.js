const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const SEED = 1234567890123456789012345678901234567890n;
const DAY = 86400;
const EV = { Death: 0, Incapacity: 1, Any: 2 };
const ST = { None: 0, Raised: 1, Cancelled: 2, Finalized: 3, Rejected: 4 };
const KIND = { Data: 0, Crypto: 1 };
const ZERO = ethers.ZeroAddress;
const EVID = ethers.id("evidence");
const NONE = [0, 0, 0, 0];
const OVER_18 = [1, 0, 0, 0];
const REENTRANT = ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10);

const randomPub = () => "0x04" + ethers.hexlify(ethers.randomBytes(64)).slice(2);
const EMPTY = { nullifier: 0, timestamp: 0, revealArray: NONE, groth16Proof: [0, 0, 0, 0, 0, 0, 0, 0] };
const policy = (o = {}) => ({
  requiredApprovals: 2, challengePeriod: 600, minInactivity: 600, unlockAfter: 0, evidenceType: EV.Any, attestationDeadline: DAY,
  requireBeneficiaryZK: false, requireAge18: false, ...o,
});
const eth = ethers.parseEther;

async function fixture() {
  const [owner, g1, g2, g3, g4, ben, other, stranger] = await ethers.getSigners();
  const verifierMock = await (await ethers.getContractFactory("MockAnonAadhaar")).deploy();
  const h = await (await ethers.getContractFactory("Heirloom")).deploy(await verifierMock.getAddress(), SEED);
  const token = await (await ethers.getContractFactory("MockERC20")).deploy("Mock USD", "mUSD", 6);
  const feeToken = await (await ethers.getContractFactory("FeeToken")).deploy();
  const reToken = await (await ethers.getContractFactory("ReentrantToken")).deploy();
  // The beneficiary registers NO encryption key: a crypto asset has nothing to decrypt.
  for (const s of [owner, g1, g2, g3, g4]) await h.connect(s).registerEncryptionKey(randomPub());
  await h.connect(owner).createVault([g1, g2, g3].map((g) => g.address), 2, 600, false);
  for (const t of [token, feeToken, reToken]) {
    await t.mint(owner.address, 1_000_000n * 10n ** 6n);
    await t.connect(owner).approve(await h.getAddress(), ethers.MaxUint256);
  }
  const addr = (c) => c.getAddress();
  const addNative = (amount, pol = {}, who = ben, signer = owner) => h.connect(signer).addCryptoAsset(who.address, ZERO, amount, policy(pol), { value: amount });
  const addToken = (t, amount, pol = {}, who = ben) => h.connect(owner).addCryptoAsset(who.address, t.target, amount, policy(pol));
  const asset = async (id) => h.getAsset(id);
  /** Raise a claim as `who` (default the beneficiary), after the inactivity period. */
  const raise = async (id = 0, who = ben, proof = EMPTY) => {
    await time.increase(601);
    return h.connect(who).raiseClaim(id, EV.Death, EVID, "ev", proof);
  };
  /** Two approvals and the challenge period: the claim is ready to finalize. */
  const approve = async (claimId = 1) => {
    await h.connect(g1).attest(claimId);
    await h.connect(g2).attest(claimId);
    await time.increase(601);
  };
  const release = async (id = 0) => {
    await raise(id);
    await approve(1);
    await h.finalizeClaim(1, EMPTY);
  };
  return { h, verifierMock, token, feeToken, reToken, owner, g1, g2, g3, g4, ben, other, stranger, addNative, addToken, asset, raise, approve, release, addr };
}

describe("Crypto assets", () => {
  describe("creating", () => {
    it("native currency: locks the value, emits events, needs no encryption key from the beneficiary", async () => {
      const c = await loadFixture(fixture);
      const { h, owner, ben } = c;
      await expect(c.addNative(eth("2"))).to.emit(h, "AssetAdded").withArgs(0, owner.address, ben.address, "", ethers.ZeroHash)
        .and.to.emit(h, "CryptoDeposited").withArgs(0, ZERO, eth("2"), eth("2"));
      const a = await c.asset(0);
      expect([a.kind, a.token, a.balance, a.owner, a.beneficiary, a.released]).to.deep.equal([BigInt(KIND.Crypto), ZERO, eth("2"), owner.address, ben.address, false]);
      expect(a.encShares.length).to.equal(0);
      expect(a.storageId).to.equal("");
      expect(await ethers.provider.getBalance(await c.addr(h))).to.equal(eth("2"));
      expect([...(await h.assetsByOwner(owner.address))]).to.deep.equal([0n]);
      expect([...(await h.assetsByBeneficiary(ben.address))]).to.deep.equal([0n]);
      expect(await h.hasEncryptionKey(ben.address)).to.equal(false);
    });

    it("ERC-20: pulls the tokens with SafeERC20 and credits them", async () => {
      const c = await loadFixture(fixture);
      const amount = 500n * 10n ** 6n;
      await expect(c.addToken(c.token, amount)).to.emit(c.h, "CryptoDeposited").withArgs(0, c.token.target, amount, amount);
      const a = await c.asset(0);
      expect([a.kind, a.token, a.balance]).to.deep.equal([BigInt(KIND.Crypto), c.token.target, amount]);
      expect(await c.token.balanceOf(await c.addr(c.h))).to.equal(amount);
      await expect(c.addToken(c.token, amount)).to.changeTokenBalances(c.token, [c.owner, c.h], [-amount, amount]);
    });

    it("credits what actually arrived for a fee-on-transfer token", async () => {
      const c = await loadFixture(fixture);
      await c.addToken(c.feeToken, 1_000_000n);
      const a = await c.asset(0);
      expect(a.balance).to.equal(990_000n); // 1% was burned in transit
      expect(await c.feeToken.balanceOf(await c.addr(c.h))).to.equal(a.balance); // the books match the real balance
    });

    it("rejects bad deposits", async () => {
      const c = await loadFixture(fixture);
      const { h, owner, ben } = c;
      const p = policy();
      await expect(h.connect(owner).addCryptoAsset(ben.address, ZERO, 0, p)).to.be.revertedWithCustomError(h, "ZeroAmount");
      await expect(h.connect(owner).addCryptoAsset(ben.address, ZERO, 5, p, { value: 4 })).to.be.revertedWithCustomError(h, "WrongValue");
      await expect(h.connect(owner).addCryptoAsset(ben.address, ZERO, 5, p)).to.be.revertedWithCustomError(h, "WrongValue");
      await expect(h.connect(owner).addCryptoAsset(ben.address, c.token.target, 5, p, { value: 5 })).to.be.revertedWithCustomError(h, "UnexpectedValue");
      await expect(h.connect(owner).addCryptoAsset(ben.address, c.stranger.address, 5, p)).to.be.revertedWithCustomError(h, "InvalidToken"); // not a contract
      await c.token.connect(c.other).mint(c.other.address, 100);
      await expect(h.connect(c.other).addCryptoAsset(ben.address, c.token.target, 5, p)).to.be.revertedWithCustomError(h, "NoVault");
      await c.token.connect(owner).approve(await c.addr(h), 1);
      await expect(h.connect(owner).addCryptoAsset(ben.address, c.token.target, 5, p)).to.be.revertedWithCustomError(c.token, "ERC20InsufficientAllowance");
      expect(await h.assetCount()).to.equal(0);
    });

    it("validates the beneficiary and the policy like any asset", async () => {
      const c = await loadFixture(fixture);
      const { h, owner, ben } = c;
      await expect(h.connect(owner).addCryptoAsset(ZERO, ZERO, 1, policy(), { value: 1 })).to.be.revertedWithCustomError(h, "InvalidBeneficiary");
      await expect(h.connect(owner).addCryptoAsset(owner.address, ZERO, 1, policy(), { value: 1 })).to.be.revertedWithCustomError(h, "InvalidBeneficiary");
      await expect(c.addNative(1, { challengePeriod: 60 })).to.be.revertedWithCustomError(h, "PeriodTooShort");
      await expect(c.addNative(1, { requiredApprovals: 1 })).to.be.revertedWithCustomError(h, "InvalidPolicy");
      await expect(c.addNative(1, { requiredApprovals: 4 })).to.be.revertedWithCustomError(h, "InvalidPolicy");
      await expect(c.addNative(1, { unlockAfter: (await time.latest()) - 1 })).to.be.revertedWithCustomError(h, "InvalidPolicy");
      await expect(c.addNative(1, { requireAge18: true })).to.be.revertedWithCustomError(h, "BeneficiaryNotVerified").withArgs(ben.address);
      expect(await h.assetCount()).to.equal(0);
    });

    it("data-only functions refuse a crypto asset", async () => {
      const c = await loadFixture(fixture);
      await c.addNative(1);
      await expect(c.h.connect(c.owner).updateAssetShares(0, ["0x01", "0x02", "0x03"], "0x01")).to.be.revertedWithCustomError(c.h, "WrongAssetKind");
    });

    it("cannot be sent funds directly", async () => {
      const c = await loadFixture(fixture);
      await expect(c.owner.sendTransaction({ to: await c.addr(c.h), value: 1 })).to.be.reverted;
    });
  });

  describe("owner top-up and withdraw", () => {
    it("tops up native and token assets", async () => {
      const c = await loadFixture(fixture);
      await c.addNative(eth("1"));
      await c.addToken(c.token, 100n);
      await expect(c.h.connect(c.owner).topUp(0, eth("0.5"), { value: eth("0.5") })).to.emit(c.h, "CryptoDeposited").withArgs(0, ZERO, eth("0.5"), eth("1.5"));
      await expect(c.h.connect(c.owner).topUp(1, 40)).to.emit(c.h, "CryptoDeposited").withArgs(1, c.token.target, 40, 140);
      expect((await c.asset(0)).balance).to.equal(eth("1.5"));
      expect((await c.asset(1)).balance).to.equal(140n);
      expect(await c.token.balanceOf(await c.addr(c.h))).to.equal(140n);
    });

    it("top-up validates amount, value, owner and kind", async () => {
      const c = await loadFixture(fixture);
      await c.addNative(10);
      await c.addToken(c.token, 10);
      const { h, owner } = c;
      await expect(h.connect(owner).topUp(0, 0)).to.be.revertedWithCustomError(h, "ZeroAmount");
      await expect(h.connect(owner).topUp(0, 5, { value: 4 })).to.be.revertedWithCustomError(h, "WrongValue");
      await expect(h.connect(owner).topUp(1, 5, { value: 5 })).to.be.revertedWithCustomError(h, "UnexpectedValue");
      await expect(h.connect(c.stranger).topUp(0, 5, { value: 5 })).to.be.revertedWithCustomError(h, "NotOwner");
      await expect(h.connect(c.ben).topUp(0, 5, { value: 5 })).to.be.revertedWithCustomError(h, "NotOwner");
      await expect(h.connect(owner).topUp(9, 5, { value: 5 })).to.be.revertedWithCustomError(h, "NoSuchAsset");
      // a data asset cannot be topped up
      await h.connect(c.g4).registerEncryptionKey(randomPub()).catch(() => {});
      await c.h.connect(c.owner).addAsset(c.g1.address, "cid", ethers.id("x"), ["0x01", "0x02", "0x03"], "0x" + "ee".repeat(8), policy());
      await expect(h.connect(owner).topUp(2, 5, { value: 5 })).to.be.revertedWithCustomError(h, "WrongAssetKind");
    });

    it("withdraws part or all before any claim", async () => {
      const c = await loadFixture(fixture);
      await c.addNative(eth("3"));
      await c.addToken(c.token, 1000n);
      const { h, owner } = c;
      const t1 = h.connect(owner).ownerWithdraw(0, eth("1"));
      await expect(t1).to.emit(h, "CryptoWithdrawn").withArgs(0, owner.address, ZERO, eth("1"), eth("2"));
      await expect(t1).to.changeEtherBalances([owner, h], [eth("1"), -eth("1")]);
      const t2 = h.connect(owner).ownerWithdraw(1, 1000n);
      await expect(t2).to.emit(h, "CryptoWithdrawn").withArgs(1, owner.address, c.token.target, 1000n, 0);
      await expect(t2).to.changeTokenBalances(c.token, [owner, h], [1000n, -1000n]);
      expect((await c.asset(0)).balance).to.equal(eth("2"));
      expect((await c.asset(1)).balance).to.equal(0n);
      await expect(h.connect(owner).topUp(1, 7)).to.emit(h, "CryptoDeposited"); // an emptied asset can be refilled
    });

    it("withdraw validates amount, owner and kind", async () => {
      const c = await loadFixture(fixture);
      await c.addNative(10);
      const { h, owner } = c;
      await expect(h.connect(owner).ownerWithdraw(0, 0)).to.be.revertedWithCustomError(h, "ZeroAmount");
      await expect(h.connect(owner).ownerWithdraw(0, 11)).to.be.revertedWithCustomError(h, "InsufficientBalance");
      await expect(h.connect(c.stranger).ownerWithdraw(0, 1)).to.be.revertedWithCustomError(h, "NotOwner");
      await expect(h.connect(c.ben).ownerWithdraw(0, 1)).to.be.revertedWithCustomError(h, "NotOwner");
      await expect(h.connect(owner).ownerWithdraw(5, 1)).to.be.revertedWithCustomError(h, "NoSuchAsset");
    });

    it("an emptied asset cannot be claimed", async () => {
      const c = await loadFixture(fixture);
      await c.addNative(10);
      await c.h.connect(c.owner).ownerWithdraw(0, 10);
      await time.increase(601);
      await expect(c.h.connect(c.ben).raiseClaim(0, EV.Death, EVID, "ev", EMPTY)).to.be.revertedWithCustomError(c.h, "EmptyAsset");
    });
  });

  describe("withdrawal and top-up are blocked while a claim is open", () => {
    for (const kind of ["native", "token"]) {
      it(`${kind}: blocked from the moment a claim is raised`, async () => {
        const c = await loadFixture(fixture);
        if (kind === "native") await c.addNative(eth("1")); else await c.addToken(c.token, 1000n);
        await c.raise();
        const topUp = kind === "native" ? c.h.connect(c.owner).topUp(0, 1, { value: 1 }) : c.h.connect(c.owner).topUp(0, 1);
        await expect(topUp).to.be.revertedWithCustomError(c.h, "ClaimActive");
        await expect(c.h.connect(c.owner).ownerWithdraw(0, 1)).to.be.revertedWithCustomError(c.h, "ClaimActive");
        // still blocked as approvals arrive
        await c.h.connect(c.g1).attest(1);
        await expect(c.h.connect(c.owner).ownerWithdraw(0, 1)).to.be.revertedWithCustomError(c.h, "ClaimActive");
        expect((await c.asset(0)).balance).to.equal(kind === "native" ? eth("1") : 1000n);
      });
    }

    it("a check-in voids the claim but the owner must still cancel it before moving funds", async () => {
      const c = await loadFixture(fixture);
      await c.addNative(eth("1"));
      await c.raise();
      await c.h.connect(c.owner).heartbeat();
      expect(await c.h.isClaimInvalidated(1)).to.equal(true);
      await expect(c.h.connect(c.owner).ownerWithdraw(0, 1)).to.be.revertedWithCustomError(c.h, "ClaimActive");
      await expect(c.h.connect(c.owner).cancelClaim(1)).to.emit(c.h, "ClaimCancelled");
      await expect(c.h.connect(c.owner).ownerWithdraw(0, eth("1"))).to.changeEtherBalances([c.owner, c.h], [eth("1"), -eth("1")]);
    });

    it("is open again once the claim is cancelled or rejected", async () => {
      const c = await loadFixture(fixture);
      await c.addNative(eth("2"));
      await c.raise();
      await c.h.connect(c.owner).cancelClaim(1);
      await expect(c.h.connect(c.owner).topUp(0, 5, { value: 5 })).to.emit(c.h, "CryptoDeposited");
      // a second claim, rejected by guardians
      await c.raise();
      await c.h.connect(c.g1).reject(2, ethers.id("no"));
      await c.h.connect(c.g2).reject(2, ethers.id("no"));
      expect((await c.h.getClaim(2)).status).to.equal(ST.Rejected);
      await expect(c.h.connect(c.owner).ownerWithdraw(0, 5)).to.emit(c.h, "CryptoWithdrawn");
    });

    it("is closed for good after release: the funds belong to the beneficiary", async () => {
      const c = await loadFixture(fixture);
      await c.addNative(eth("1"));
      await c.release();
      await expect(c.h.connect(c.owner).ownerWithdraw(0, 1)).to.be.revertedWithCustomError(c.h, "AssetAlreadyReleased");
      await expect(c.h.connect(c.owner).topUp(0, 1, { value: 1 })).to.be.revertedWithCustomError(c.h, "AssetAlreadyReleased");
    });
  });

  describe("claims and withdrawal by the beneficiary", () => {
    for (const kind of ["native", "token"]) {
      it(`${kind}: finalizing only unlocks the funds; the beneficiary pulls them with withdraw()`, async () => {
        const c = await loadFixture(fixture);
        const amount = kind === "native" ? eth("1.5") : 750n * 10n ** 6n;
        if (kind === "native") await c.addNative(amount); else await c.addToken(c.token, amount);
        const held = () => (kind === "native" ? ethers.provider.getBalance(c.h.target) : c.token.balanceOf(c.h.target));
        await c.raise();
        await expect(c.h.connect(c.ben).withdraw(0)).to.be.revertedWithCustomError(c.h, "NotReleased"); // a claim alone does nothing
        await c.approve(1);
        await expect(c.h.connect(c.ben).withdraw(0)).to.be.revertedWithCustomError(c.h, "NotReleased"); // nor does approval
        await c.h.connect(c.stranger).finalizeClaim(1, EMPTY); // anyone can finalize; nothing moves
        expect(await held()).to.equal(amount);
        expect((await c.asset(0)).released).to.equal(true);
        expect((await c.asset(0)).balance).to.equal(amount);

        await expect(c.h.connect(c.stranger).withdraw(0)).to.be.revertedWithCustomError(c.h, "NotBeneficiary");
        await expect(c.h.connect(c.owner).withdraw(0)).to.be.revertedWithCustomError(c.h, "NotBeneficiary");
        const tx = c.h.connect(c.ben).withdraw(0);
        await expect(tx).to.emit(c.h, "CryptoClaimed").withArgs(0, c.ben.address, kind === "native" ? ZERO : c.token.target, amount);
        if (kind === "native") await expect(tx).to.changeEtherBalances([c.ben, c.h], [amount, -amount]);
        else await expect(tx).to.changeTokenBalances(c.token, [c.ben, c.h], [amount, -amount]);
        expect((await c.asset(0)).balance).to.equal(0n);
        await expect(c.h.connect(c.ben).withdraw(0)).to.be.revertedWithCustomError(c.h, "NothingToWithdraw"); // once
      });
    }

    it("withdraw is for crypto assets only", async () => {
      const c = await loadFixture(fixture);
      await c.h.connect(c.owner).addAsset(c.g1.address, "cid", ethers.id("x"), ["0x01", "0x02", "0x03"], "0x" + "ee".repeat(8), policy());
      await expect(c.h.connect(c.g1).withdraw(0)).to.be.revertedWithCustomError(c.h, "WrongAssetKind");
    });

    it("the same policy and claim rules apply", async () => {
      const c = await loadFixture(fixture);
      const unlock = (await time.latest()) + 5 * DAY;
      await c.addNative(eth("1"), { unlockAfter: unlock, requiredApprovals: 3, attestationDeadline: 30 * DAY });
      await c.raise();
      await c.h.connect(c.g1).attest(1);
      await c.h.connect(c.g2).attest(1);
      await expect(c.h.finalizeClaim(1, EMPTY)).to.be.revertedWithCustomError(c.h, "ChallengePeriodNotOver");
      await time.increase(601);
      await expect(c.h.finalizeClaim(1, EMPTY)).to.be.revertedWithCustomError(c.h, "NotYetUnlocked");
      await time.increaseTo(unlock);
      await expect(c.h.finalizeClaim(1, EMPTY)).to.be.revertedWithCustomError(c.h, "NotEnoughApprovals"); // 3 required, 2 given
      await c.h.connect(c.g3).attest(1);
      await expect(c.h.finalizeClaim(1, EMPTY)).to.emit(c.h, "ClaimFinalized");
      await expect(c.h.connect(c.ben).withdraw(0)).to.emit(c.h, "CryptoClaimed");
    });

    it("an owner check-in, a fraud flag or a cancellation stop the funds from ever being released", async () => {
      const c = await loadFixture(fixture);
      await c.addNative(eth("1"));
      await c.raise();
      await c.approve(1);
      await c.h.connect(c.owner).heartbeat();
      await expect(c.h.finalizeClaim(1, EMPTY)).to.be.revertedWithCustomError(c.h, "ClaimInvalidatedByHeartbeat");
      await c.h.connect(c.owner).cancelClaim(1);
      await c.raise();
      await c.h.connect(c.g1).flagFraud(2);
      await time.increase(DAY + 1);
      await expect(c.h.finalizeClaim(2, EMPTY)).to.be.revertedWithCustomError(c.h, "ClaimFlaggedFraud");
      await expect(c.h.connect(c.ben).withdraw(0)).to.be.revertedWithCustomError(c.h, "NotReleased");
      expect((await c.asset(0)).balance).to.equal(eth("1"));
    });

    it("guardians have no share to release for a crypto asset", async () => {
      const c = await loadFixture(fixture);
      await c.addNative(eth("1"));
      await c.release();
      await expect(c.h.connect(c.g1).submitShare(1, "0x01")).to.be.revertedWithCustomError(c.h, "WrongAssetKind");
    });

    it("replacing guardians does not strand a crypto asset", async () => {
      const c = await loadFixture(fixture);
      await c.addNative(eth("1"));
      await c.h.connect(c.owner).rotateGuardians([c.g1, c.g2, c.g4].map((g) => g.address), 2, false);
      await time.increase(601);
      // a data asset would now be stale; a crypto asset has nothing to re-share
      await expect(c.h.connect(c.ben).raiseClaim(0, EV.Death, EVID, "ev", EMPTY)).to.emit(c.h, "ClaimRaised");
      await c.h.connect(c.g1).attest(1);
      await expect(c.h.connect(c.g3).attest(1)).to.be.revertedWithCustomError(c.h, "NotGuardian"); // the old guardian has no say
      await c.h.connect(c.g4).attest(1);
      await time.increase(601);
      await expect(c.h.finalizeClaim(1, EMPTY)).to.emit(c.h, "ClaimFinalized");
    });

    it("identity policies apply: an over-18 proof is needed to finalize", async () => {
      const c = await loadFixture(fixture);
      const N = 111111111111111111111111111111111111111111111111111111111111111111111n;
      const sig = await c.h.identitySignal(c.ben.address);
      let ts = await time.latest();
      let p = await c.verifierMock.proofFor(SEED, N, ts, sig, NONE);
      await c.h.connect(c.ben).verifyIdentity({ nullifier: N, timestamp: ts, revealArray: NONE, groth16Proof: [...p] });
      await c.addNative(eth("1"), { requireAge18: true });
      await c.raise();
      await c.approve(1);
      await expect(c.h.finalizeClaim(1, EMPTY)).to.be.revertedWithCustomError(c.h, "NullifierMismatch");
      ts = await time.latest();
      p = await c.verifierMock.proofFor(SEED, N, ts, await c.h.ageSignal(1, c.ben.address), OVER_18);
      await expect(c.h.finalizeClaim(1, { nullifier: N, timestamp: ts, revealArray: OVER_18, groth16Proof: [...p] })).to.emit(c.h, "ClaimFinalized");
      await expect(c.h.connect(c.ben).withdraw(0)).to.changeEtherBalances([c.ben], [eth("1")]);
    });

    it("assets of the same token are accounted separately", async () => {
      const c = await loadFixture(fixture);
      await c.addToken(c.token, 100n); // asset 0
      await c.addToken(c.token, 50n, {}, c.other); // asset 1, another beneficiary
      await c.release(0);
      await c.h.connect(c.ben).withdraw(0);
      expect((await c.asset(0)).balance).to.equal(0n);
      expect((await c.asset(1)).balance).to.equal(50n);
      expect(await c.token.balanceOf(c.h.target)).to.equal(50n);
      await expect(c.h.connect(c.owner).ownerWithdraw(1, 50n)).to.changeTokenBalances(c.token, [c.owner, c.h], [50n, -50n]);
    });
  });

  describe("reentrancy", () => {
    it("a token that re-enters during a deposit is stopped, and the deposit is credited once", async () => {
      const c = await loadFixture(fixture);
      await c.addToken(c.reToken, 100n);
      const hit = c.h.interface.encodeFunctionData("topUp", [0, 1]);
      await c.reToken.arm(c.h.target, hit);
      await c.h.connect(c.owner).topUp(0, 50n);
      expect(await c.reToken.reentries()).to.equal(1n);
      expect(await c.reToken.reentrySucceeded()).to.equal(false);
      expect(await c.reToken.reentryError()).to.equal(REENTRANT);
      expect((await c.asset(0)).balance).to.equal(150n);
      expect(await c.reToken.balanceOf(c.h.target)).to.equal(150n);
    });

    it("a token that re-enters during the beneficiary's withdraw cannot withdraw twice", async () => {
      const c = await loadFixture(fixture);
      await c.addToken(c.reToken, 1000n);
      await c.release();
      await c.reToken.arm(c.h.target, c.h.interface.encodeFunctionData("withdraw", [0]));
      await expect(c.h.connect(c.ben).withdraw(0)).to.changeTokenBalances(c.reToken, [c.ben, c.h], [1000n, -1000n]);
      expect(await c.reToken.reentrySucceeded()).to.equal(false);
      expect(await c.reToken.reentryError()).to.equal(REENTRANT);
      expect((await c.asset(0)).balance).to.equal(0n);
    });

    it("a token that re-enters during the owner's withdraw cannot drain the asset", async () => {
      const c = await loadFixture(fixture);
      await c.addToken(c.reToken, 1000n);
      await c.reToken.arm(c.h.target, c.h.interface.encodeFunctionData("ownerWithdraw", [0, 1]));
      await c.h.connect(c.owner).ownerWithdraw(0, 400n);
      expect(await c.reToken.reentrySucceeded()).to.equal(false);
      expect(await c.reToken.reentryError()).to.equal(REENTRANT);
      expect((await c.asset(0)).balance).to.equal(600n);
      expect(await c.reToken.balanceOf(c.h.target)).to.equal(600n);
    });

    it("a contract beneficiary that re-enters withdraw() from receive() is paid exactly once", async () => {
      const c = await loadFixture(fixture);
      const attacker = await (await ethers.getContractFactory("CryptoAttacker")).deploy(c.h.target);
      await c.h.connect(c.owner).addCryptoAsset(attacker.target, ZERO, eth("2"), policy(), { value: eth("2") });
      await time.increase(601);
      await attacker.raise(0, EV.Death, EVID, "ev", EMPTY);
      await c.approve(1);
      await c.h.finalizeClaim(1, EMPTY);

      await attacker.setReenter(true, false, 0);
      await expect(attacker.pull(0)).to.changeEtherBalances([attacker, c.h], [eth("2"), -eth("2")]);
      expect(await attacker.reentrySucceeded()).to.equal(false);
      expect(await attacker.reentryError()).to.equal(REENTRANT);
      expect(await attacker.received()).to.equal(eth("2")); // paid once
      expect(await ethers.provider.getBalance(c.h.target)).to.equal(0n);
      await expect(attacker.pull(0)).to.be.revertedWithCustomError(c.h, "NothingToWithdraw");
    });

    it("a contract owner that re-enters ownerWithdraw() from receive() gets only what it asked for", async () => {
      const c = await loadFixture(fixture);
      const attacker = await (await ethers.getContractFactory("CryptoAttacker")).deploy(c.h.target);
      await attacker.registerKey(randomPub());
      await attacker.createVault([c.g1, c.g2, c.g3].map((g) => g.address), 2, 600);
      await attacker.addNative(c.ben.address, policy(), { value: eth("4") });
      await attacker.setReenter(false, true, 0);
      await attacker.pullOwner(0, eth("1"));
      expect(await attacker.reentrySucceeded()).to.equal(false);
      expect(await attacker.reentryError()).to.equal(REENTRANT);
      expect(await attacker.received()).to.equal(eth("1"));
      expect((await c.h.getAsset(0)).balance).to.equal(eth("3"));
      expect(await ethers.provider.getBalance(c.h.target)).to.equal(eth("3"));
    });

    it("a beneficiary that cannot receive native currency keeps its funds safe in the asset", async () => {
      const c = await loadFixture(fixture);
      const rejector = await (await ethers.getContractFactory("MockERC20")).deploy("x", "x", 18); // has no receive()
      await c.h.connect(c.owner).addCryptoAsset(rejector.target, ZERO, eth("1"), policy(), { value: eth("1") });
      await time.increase(601);
      // it cannot even raise a claim (no code to call raiseClaim), so the owner simply keeps control
      await expect(c.h.connect(c.owner).ownerWithdraw(0, eth("1"))).to.changeEtherBalances([c.owner, c.h], [eth("1"), -eth("1")]);
    });
  });

  describe("accounting", () => {
    it("the contract always holds exactly the sum of the asset balances", async () => {
      const c = await loadFixture(fixture);
      await c.addNative(eth("3")); // 0
      await c.addNative(eth("2"), {}, c.other); // 1
      await c.h.connect(c.owner).topUp(0, eth("1"), { value: eth("1") });
      await c.h.connect(c.owner).ownerWithdraw(1, eth("0.5"));
      const sum = async () => {
        let t = 0n;
        for (let i = 0; i < Number(await c.h.assetCount()); i++) t += (await c.h.getAsset(i)).balance;
        return t;
      };
      expect(await ethers.provider.getBalance(c.h.target)).to.equal(await sum());
      await c.release(0);
      await c.h.connect(c.ben).withdraw(0);
      expect(await ethers.provider.getBalance(c.h.target)).to.equal(await sum());
      expect(await sum()).to.equal(eth("1.5"));
    });
  });
});
