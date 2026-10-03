import { getDeployment } from "../contract";

/**
 * Zero-knowledge identity configuration.
 *
 *  NEXT_PUBLIC_ANON_AADHAAR_MODE = "test" | "real"
 *     "test": the SDK accepts only test QR codes (signed with the published test key). "real": only genuine UIDAI-signed
 *     Aadhaar QR codes. It must match what the deployed verifier trusts; if unset it follows the deployment.
 *  NEXT_PUBLIC_ZK_PROVER = "sdk" (default) | "mock"
 *     "mock" swaps the Anon Aadhaar SDK for a test double and only works against a locally deployed MockAnonAadhaar.
 *     It exists so the whole app can be exercised on a local chain without the 600 MB circuit key. It is refused anywhere else.
 */
export type ZkMode = "test" | "real";

export type ZkDeployment = {
  verifier: string; // AnonAadhaar contract, or the zero address when the deployment has none
  mode: string; // what the deploy script recorded: test | real | custom | mock | none
  nullifierSeed: bigint;
};

export function zkDeployment(chainId: number | undefined): ZkDeployment | null {
  const d = getDeployment(chainId);
  if (!d?.anonAadhaar || !d.nullifierSeed) return null;
  return { verifier: d.anonAadhaar, mode: d.anonAadhaarMode ?? "custom", nullifierSeed: BigInt(d.nullifierSeed) };
}

export const identityEnabled = (chainId: number | undefined) => {
  const z = zkDeployment(chainId);
  return Boolean(z && z.mode !== "none" && !/^0x0{40}$/i.test(z.verifier));
};

export function sdkMode(chainId: number | undefined): ZkMode {
  const env = process.env.NEXT_PUBLIC_ANON_AADHAAR_MODE;
  if (env === "test" || env === "real") return env;
  return zkDeployment(chainId)?.mode === "real" ? "real" : "test";
}

/** The mock prover is used only when asked for AND the deployment is the local mock verifier. */
export const mockProverActive = (chainId: number | undefined) =>
  process.env.NEXT_PUBLIC_ZK_PROVER === "mock" && chainId === 31337 && zkDeployment(chainId)?.mode === "mock";

/** A mismatch between what the app will accept and what the contract trusts would make every proof fail on-chain. */
export function modeProblem(chainId: number | undefined): string | null {
  const z = zkDeployment(chainId);
  if (!z || mockProverActive(chainId)) return null;
  if (z.mode === "mock") return "This deployment uses a local test verifier. Set NEXT_PUBLIC_ZK_PROVER=mock to use it.";
  if ((z.mode === "test" || z.mode === "real") && sdkMode(chainId) !== z.mode) {
    return `The verifier on this network trusts ${z.mode} Aadhaar QR codes, but the app is set to ${sdkMode(chainId)}. Proofs would be rejected.`;
  }
  return null;
}
