import type { PublicClient } from "viem";
import { sdkMode, mockProverActive } from "./config";

/** The proof as the contract takes it (struct ZkProof). */
export type ZkProof = {
  nullifier: bigint;
  timestamp: bigint;
  revealArray: readonly [bigint, bigint, bigint, bigint]; // [ageAbove18, gender, pincode, state]
  groth16Proof: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
};

/** For flows whose policy does not require identity: ignored by the contract. */
export const NO_PROOF: ZkProof = { nullifier: 0n, timestamp: 0n, revealArray: [0n, 0n, 0n, 0n], groth16Proof: [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] };

export type ProofRequest = {
  chainId: number;
  /** The contract-derived signal this proof must be bound to (identity, claim or age; see Heirloom.sol). */
  signal: bigint;
  nullifierSeed: bigint;
  /** Prove (and reveal) only that the holder is over 18. Nothing else is ever revealed. */
  revealAge: boolean;
  /** SDK mode: the Aadhaar QR code's data. Mock mode: a test person id. */
  input: string;
  onStage?: (stage: string) => void;
  publicClient?: PublicClient;
  mockVerifier?: `0x${string}`;
};

export const STAGES: Record<string, string> = {
  initializing: "Preparing the prover…",
  "fetching-wasm": "Downloading the proving program (about 10 MB, cached afterwards)…",
  "fetching-zkey": "Downloading the proving key (large, about 600 MB the first time, cached afterwards)…",
  proving: "Generating the proof on your device. This can take a minute or two…",
  completed: "Proof ready.",
  error: "The prover reported an error.",
};

// ---- reading the QR code ----------------------------------------------------------------------------------

/** Decodes an image of an Aadhaar secure QR code into its data string. Everything happens in this browser. */
export async function readQrImage(file: File): Promise<string> {
  const jsQR = (await import("jsqr")).default;
  const bitmap = await createImageBitmap(file);
  // Aadhaar QR codes are very dense; scanning at a few sizes finds ones a single pass misses.
  for (const scale of [1, 1.5, 0.75, 2]) {
    const w = Math.min(Math.round(bitmap.width * scale), 4000);
    const h = Math.round(bitmap.height * (w / bitmap.width));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("This browser cannot read images.");
    ctx.drawImage(bitmap, 0, 0, w, h);
    const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" });
    if (code?.data) return code.data;
  }
  throw new Error("Could not read a QR code in that image. Use the secure QR image from the mAadhaar app or the UIDAI download, not a photo of a screen.");
}

// ---- proving ---------------------------------------------------------------------------------------------

let initialised: Promise<void> | null = null;

/** Same defaults as the SDK's own provider: the v2 circuit, with the proving key fetched in chunks. */
function initSdk(core: typeof import("@anon-aadhaar/core")) {
  initialised ??= core
    .init({
      wasmURL: core.artifactUrls.v2.wasm,
      zkeyURL: core.artifactUrls.v2.chunked,
      vkeyURL: core.artifactUrls.v2.vk,
      artifactsOrigin: core.ArtifactsOrigin.chunked,
    })
    .then(() => undefined)
    .catch((e) => {
      initialised = null; // allow a retry
      throw e;
    });
  return initialised;
}

async function proveWithSdk(req: ProofRequest): Promise<ZkProof> {
  const [core, react] = await Promise.all([import("@anon-aadhaar/core"), import("@anon-aadhaar/react")]);
  req.onStage?.("initializing");
  await initSdk(core);

  // The signal is passed as a decimal string: the SDK hashes it exactly as the verifier contract hashes the uint.
  const test = sdkMode(req.chainId) === "test";
  let args;
  try {
    args = await react.processAadhaarArgs(req.input, test, req.nullifierSeed, req.revealAge ? ["revealAgeAbove18"] : [], req.signal.toString());
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(`That QR code was not accepted as ${test ? "a test " : "an "}Aadhaar secure QR code${test ? " (this deployment accepts test QR codes only)" : ""}. (${why})`);
  }
  const { anonAadhaarProof } = await react.proveAndSerialize(args, (s) => req.onStage?.(typeof s === "function" ? "" : String(s)));
  const p = anonAadhaarProof.proof;

  // Never send a proof the contract is going to reject: check it is bound to what we asked for.
  if (BigInt(p.nullifierSeed) !== req.nullifierSeed) throw new Error("The proof was made for a different nullifier seed.");
  if (BigInt(p.signalHash) !== BigInt(core.hash(req.signal.toString()))) throw new Error("The proof is not bound to the expected signal.");

  return {
    nullifier: BigInt(p.nullifier),
    timestamp: BigInt(p.timestamp),
    revealArray: [BigInt(p.ageAbove18), BigInt(p.gender), BigInt(p.pincode), BigInt(p.state)],
    groth16Proof: core.packGroth16Proof(p.groth16Proof).map((x) => BigInt(x)) as unknown as ZkProof["groth16Proof"],
  };
}

export async function generateProof(req: ProofRequest): Promise<ZkProof> {
  if (mockProverActive(req.chainId)) {
    // Dead-code-eliminated from production builds: the flag below is inlined at build time.
    if (process.env.NEXT_PUBLIC_ZK_PROVER === "mock") {
      const { proveWithMock } = await import("./mockProver");
      return proveWithMock(req);
    }
  }
  return proveWithSdk(req);
}
