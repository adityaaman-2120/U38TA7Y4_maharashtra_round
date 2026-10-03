// TEST DOUBLE. Loaded only when NEXT_PUBLIC_ZK_PROVER=mock, and used only against a local MockAnonAadhaar.
// It does not touch an Aadhaar QR code: the "input" is a made-up person id, hashed into a nullifier. Two wallets given the
// same id therefore get the same nullifier, which is how the one-person-one-wallet rule can be exercised locally.
import { encodeAbiParameters, keccak256, parseAbiParameters, toBytes } from "viem";
import type { ProofRequest, ZkProof } from "./proof";

const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const MOCK_ABI = [
  {
    type: "function", name: "proofFor", stateMutability: "pure",
    inputs: [
      { name: "seed", type: "uint256" }, { name: "nullifier", type: "uint256" }, { name: "timestamp", type: "uint256" },
      { name: "signal", type: "uint256" }, { name: "reveal", type: "uint256[4]" },
    ],
    outputs: [{ type: "uint256[8]" }],
  },
] as const;

export async function proveWithMock(req: ProofRequest): Promise<ZkProof> {
  if (req.chainId !== 31337 || !req.publicClient || !req.mockVerifier) throw new Error("The mock prover only works on a local chain.");
  // "<id>" or "<id>|minor": the part before "|" is the person (it becomes the nullifier); "|minor" makes the same person under 18.
  const [personId, flag] = req.input.trim().split("|");
  const person = personId.trim();
  if (!person) throw new Error("Enter a test person id.");
  req.onStage?.("proving");

  const nullifier = BigInt(keccak256(encodeAbiParameters(parseAbiParameters("bytes32, string"), [keccak256(toBytes("heirloom.mock.person")), person]))) % FIELD;
  // The mock has no date of birth to look at, so the "|minor" flag stands in for being under 18.
  const over18 = req.revealAge && !/minor/i.test(flag ?? "") ? 1n : 0n;
  const reveal = [over18, 0n, 0n, 0n] as const;
  const block = await req.publicClient.getBlock();
  const timestamp = block.timestamp; // chain time, so the contract's freshness window is met on a local node with a skewed clock
  const groth16Proof = await req.publicClient.readContract({
    address: req.mockVerifier, abi: MOCK_ABI, functionName: "proofFor", args: [req.nullifierSeed, nullifier, timestamp, req.signal, reveal],
  });
  return { nullifier, timestamp, revealArray: reveal, groth16Proof: groth16Proof as unknown as ZkProof["groth16Proof"] };
}
