// Type facade for the parts of @anon-aadhaar/core that Heirloom uses.
//
// The package declares `"types": "./src/index.ts"`, so TypeScript compiles its raw source under our strict settings and
// reports errors inside node_modules that we cannot fix (the same happens through @anon-aadhaar/react's own typings).
// tsconfig.json therefore maps "@anon-aadhaar/core" to this folder: this file supplies the types and index.js re-exports the
// real package, so the bundler loads the very same module instance the React package uses (its prover state is shared).
// Keep in sync with the version pinned in package.json (2.4.3).
export type FieldsToRevealArray = ("revealAgeAbove18" | "revealGender" | "revealPinCode" | "revealState")[];
export type AnonAadhaarArgs = Record<string, unknown>;

export type Groth16Proof = { pi_a: string[]; pi_b: string[][]; pi_c: string[]; protocol: string; curve: string };

export type AnonAadhaarProof = {
  groth16Proof: Groth16Proof;
  pubkeyHash: string;
  timestamp: string;
  nullifierSeed: string;
  nullifier: string;
  signalHash: string;
  ageAbove18: string;
  gender: string;
  pincode: string;
  state: string;
};

export type AnonAadhaarCore = { type: string; id: string; claim: unknown; proof: AnonAadhaarProof };

export declare enum ProverState {
  Initializing = "initializing",
  FetchingWasm = "fetching-wasm",
  FetchingZkey = "fetching-zkey",
  Proving = "proving",
  Completed = "completed",
  Error = "error",
}

export declare enum ArtifactsOrigin {
  server = 0,
  local = 1,
  chunked = 2,
}

export declare const artifactUrls: { v2: { wasm: string; zkey: string; vk: string; chunked: string } };
export declare const testPublicKeyHash: string;
export declare const productionPublicKeyHash: string;

export declare function init(args: { wasmURL: string; zkeyURL: string; vkeyURL: string; artifactsOrigin: ArtifactsOrigin }): Promise<void>;
export declare function hash(message: string | number | bigint): string;
export declare function packGroth16Proof(proof: Groth16Proof): string[];
