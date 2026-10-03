import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";
import { rt } from "@/i18n/runtime";
import en from "@/messages/en/lib.json";

// Every contract error that has a message in the catalogue; anything else falls back to the error's own name.
const KNOWN = new Set(Object.keys(en.Errors.contract));

export function humanError(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return rt("Errors.rejected");
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = rev?.data?.errorName;
    if (name) return KNOWN.has(name) ? rt(`Errors.contract.${name}`) : name;
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}
