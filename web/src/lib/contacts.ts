import { useQuery } from "@tanstack/react-query";
import { inviteApi, type Invite, type Role } from "./api";

/** People who accepted the owner's invitation in this role: the only people the owner may add on-chain. */
export function useContacts(role: Role) {
  return useQuery({
    queryKey: ["contacts", role],
    queryFn: async () => (await inviteApi.contacts(role)).filter((i): i is Invite & { invitee: NonNullable<Invite["invitee"]> } => Boolean(i.invitee)),
    refetchInterval: 15000,
  });
}
