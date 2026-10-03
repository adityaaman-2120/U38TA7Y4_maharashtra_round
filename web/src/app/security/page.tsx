import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/Logo";

export const metadata: Metadata = {
  title: "Heirloom — Security: what is stored, and why nobody can read it",
  description: "Exactly what the blockchain, Heirloom's server and the storage provider each hold, and why none of them can decrypt your files.",
};

type Row = { what: string; form: string; who: string };

const CHAIN: Row[] = [
  { what: "Encryption public keys", form: "One public key per person who registered one.", who: "Anyone. Public keys are meant to be shared." },
  { what: "Your vault", form: "Owner address, the guardians' addresses, the approval threshold, check-in interval, time of last check-in, frozen flag, and a counter that rises when guardians change.", who: "Anyone. Addresses carry no names." },
  { what: "Each reserved file", form: "Beneficiary address, the IPFS id of the encrypted file, a salted SHA-256 fingerprint of the content, and the policy numbers (approvals needed, waiting periods, evidence type, optional unlock time).", who: "Anyone can see these facts. Nobody can see the content." },
  { what: "Crypto assets", form: "For an asset that holds funds: the token address (or native currency) and the amount locked, with every deposit and withdrawal as an event.", who: "Anyone. Unlike files, amounts are public on the blockchain; wallet addresses carry no names." },
  { what: "Key shares", form: "One share of each file's key per guardian, each encrypted to that guardian's public key, plus one copy of the key encrypted to the owner's public key.", who: "Only the guardian (or the owner) whose private key matches." },
  { what: "Each claim", form: "Who raised it and when, the evidence type, a salted fingerprint and IPFS id of the encrypted evidence, approval and rejection counts, the fraud flag, and later the shares each guardian re-encrypted to the beneficiary.", who: "Anyone sees the facts. Only the beneficiary can open released shares." },
  { what: "Verified identity (optional)", form: "For each wallet that verified: a nullifier, a one-way pseudonym derived for Heirloom only. A claim's transaction also carries the zero-knowledge proof, which for an over-18 check includes that single bit. Never an Aadhaar number, name, date of birth, address or photo.", who: "Anyone. The pseudonym cannot be traced to an Aadhaar or linked to activity in other apps." },
  { what: "Event history", form: "A log entry for every action above. A guardian's reason for rejecting is stored only as a hash.", who: "Anyone. This is the audit trail." },
];

const SERVER: Row[] = [
  { what: "Your account", form: "Wallet address, name, email, and an optional phone number, exactly as you entered them.", who: "Heirloom's server. Never on the blockchain." },
  { what: "Your sealed encryption key", form: "Your private key, already encrypted in your browser with AES-256-GCM under a key derived from your password (PBKDF2-SHA256, 600,000 rounds). Stored so you can sign in from another device.", who: "Stored by the server, but unreadable without your password, which never leaves your browser." },
  { what: "Aadhaar data", form: "None. The Aadhaar QR code is read and the proof is generated in your browser; the server receives neither.", who: "Nobody but you." },
  { what: "Invitations", form: "The invitee's email, the name you gave them, their role, status and expiry. The emailed link carries a signed token, not personal data.", who: "The server and the invited person's inbox." },
  { what: "Notifications", form: "The text of each alert and email (for example \"claim #2 was raised on asset #0\") and whether it was read. No file contents.", who: "The server, plus your mail provider when an email is sent." },
  { what: "A copy of the chain's events", form: "The same public events as above, plus the address that sent each transaction, so the audit page and alerts are fast.", who: "The server. It adds nothing that is not already public." },
  { what: "Alert settings and log", form: "Which channels you turned on, whether your email and phone were verified, and a log of each alert sent (type, channel, time, outcome). The log holds no email address, phone number or message text.", who: "The server. Your phone number goes to the SMS provider (Twilio) only when a text is sent." },
  { what: "Short-lived session data", form: "A session cookie your browser keeps (JavaScript cannot read it), one-time sign-in challenges, and rate-limit counters.", who: "The server, for minutes to hours." },
];

const STORAGE: Row[] = [
  { what: "Encrypted files and letters", form: "AES-256-GCM ciphertext. The file name and a random salt are inside the encryption, so even they are hidden. Its size is visible.", who: "The storage provider (IPFS, via Pinata) and anyone with the id. Unreadable without the key." },
  { what: "Encrypted evidence", form: "A bundle of ciphertext plus the evidence key encrypted separately to each guardian and the owner.", who: "As above. Only those named can unwrap the key." },
];

const NEVER = [
  "The plaintext of any file, letter or evidence.",
  "A file's encryption key (DEK) in any usable form. It exists whole only in your browser while you upload, and later in the beneficiary's browser.",
  "Your encryption private key unsealed, or the password that seals it.",
  "Any guardian's share of a key in plaintext.",
  "Your Aadhaar QR code, or any field in it: Aadhaar number, name, date of birth, address, photo.",
];

const WHY: { title: string; body: string }[] = [
  { title: "The key is born in your browser", body: "Each file gets a fresh random 256-bit key from the browser's secure random generator. The file is encrypted with it (AES-256-GCM) before anything is uploaded, so the server and the storage provider only ever receive ciphertext." },
  { title: "The key is split, then locked per person", body: "The key is cut into shares so that any threshold of guardians (for example 2 of 3) can rebuild it, and fewer than that learn nothing. Each share is then encrypted to one guardian's public key. The blockchain holds those locked shares; only the matching private key opens each one." },
  { title: "Private keys stay sealed", body: "Every person's private key is generated in their browser and encrypted under their password before it is stored anywhere. The server holds only that sealed blob. The password is never sent." },
  { title: "Release is deliberate and public", body: "After enough guardians approve and the waiting period passes, each guardian decrypts their own share in their browser and re-encrypts it to the beneficiary's key. The beneficiary combines them and decrypts the file locally, then checks it against the on-chain fingerprint." },
  { title: "Fingerprints are salted", body: "The on-chain fingerprint of a file is SHA-256 of a random salt plus the content, with the salt stored inside the encrypted file. Without that salt nobody can confirm a guess about a short text, such as a one-line letter, by hashing it." },
];

const LIMITS: { title: string; body: ReactNode }[] = [
  { title: "Metadata is visible", body: "Anyone can see which addresses are guardians and beneficiaries, when files were reserved, when claims were raised, and the size of each encrypted file. The server also knows your name and email." },
  { title: "A weak password can be guessed offline", body: "Because the sealed key is stored on the server, someone who obtained it could try passwords against it. The 600,000-round key derivation makes each guess slow, but only a long, unique password truly protects you. We require at least 12 characters." },
  { title: "You trust the code you are served", body: "The app runs in your browser, and the encryption happens there. A compromised web host could serve altered code. Open-source and reproducible builds would reduce this; they are not in place yet." },
  { title: "Guardians are a trust assumption", body: "If enough guardians to meet the threshold collude with a beneficiary, they could release a file early. Your check-ins, the waiting period, the fraud flag and the freeze button exist to make that hard to do unnoticed." },
  { title: "Identity proofs have their own assumptions", body: "Verification uses the open-source Anon Aadhaar protocol. UIDAI, which issues Aadhaar, could in principle deanonymize a holder; the protocol hides identities from everyone else. A deployment is set to accept either test QR codes or genuine ones, and test deployments accept test QR codes only. Proving in the browser downloads a large circuit key (about 600 MB, once) from the Anon Aadhaar project's storage." },
  { title: "This is an unaudited prototype", body: "The smart contract and the app have been tested but not independently audited. Do not store anything you cannot afford to lose." },
];

function Table({ title, intro, rows }: { title: string; intro: string; rows: Row[] }) {
  return (
    <section className="mt-14">
      <h2 className="font-display text-3xl text-ink sm:text-4xl">{title}</h2>
      <p className="mt-2 max-w-3xl text-ink-2">{intro}</p>
      <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="hidden grid-cols-[1fr_2fr_1.4fr] gap-6 border-b border-line bg-sunken px-5 py-2.5 text-xs font-medium uppercase tracking-wider text-muted md:grid">
          <span>What</span><span>In what form</span><span>Who can read it</span>
        </div>
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.what} className="grid gap-1 px-5 py-4 md:grid-cols-[1fr_2fr_1.4fr] md:gap-6">
              <p className="font-medium text-ink">{r.what}</p>
              <p className="text-sm leading-relaxed text-ink-2"><span className="text-xs uppercase tracking-wider text-faint md:hidden">Form: </span>{r.form}</p>
              <p className="text-sm leading-relaxed text-muted"><span className="text-xs uppercase tracking-wider text-faint md:hidden">Readable by: </span>{r.who}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default function SecurityPage() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" aria-label="Heirloom home"><Wordmark /></Link>
        <Link href="/app" className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink-2">Open app</Link>
      </header>

      <main className="mx-auto max-w-5xl px-5 pb-24 sm:px-8">
        <p className="mt-8 text-xs font-medium uppercase tracking-[0.2em] text-brass">Security</p>
        <h1 className="mt-3 max-w-3xl font-display text-[clamp(2.4rem,6vw,4.2rem)] leading-[1.02] text-ink">What is stored, and why nobody can read it.</h1>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-ink-2">
          Three places hold something about your vault: the blockchain, Heirloom&apos;s server, and a storage provider. This page lists exactly what each one holds, and
          the reason none of them, nor Heirloom, can decrypt your files.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {[
            ["Files are encrypted before upload", "In your browser, with a key only you create."],
            ["No one holds a whole key", "Guardians each hold one locked piece. Fewer than the threshold learn nothing."],
            ["Everything that matters is public", "Rules and every action are on a ledger anyone can audit."],
          ].map(([t, b]) => (
            <div key={t} className="rounded-2xl border border-line bg-surface p-5"><p className="font-display text-xl text-ink">{t}</p><p className="mt-1 text-sm text-ink-2">{b}</p></div>
          ))}
        </div>

        <Table title="On the blockchain" intro="Public by design. Everyone can read this, and none of it contains a file, a plaintext key, or a personal detail." rows={CHAIN} />
        <Table title="On Heirloom's server" intro="Ordinary account data, plus your key in sealed form. This is the only place your name and email live." rows={SERVER} />
        <Table title="At the storage provider" intro="Files are kept on IPFS through Pinata. Heirloom's upload route only relays what your browser has already encrypted." rows={STORAGE} />

        <section className="mt-14 rounded-2xl bg-accent-soft p-6 sm:p-8">
          <h2 className="font-display text-3xl text-ink">What nobody stores</h2>
          <ul className="mt-4 space-y-2 text-ink">
            {NEVER.map((n) => <li key={n} className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{n}</li>)}
          </ul>
        </section>

        <section className="mt-14">
          <h2 className="font-display text-3xl text-ink sm:text-4xl">Why none of them can decrypt</h2>
          <ol className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
            {WHY.map((w, i) => (
              <li key={w.title} className="bg-surface p-6">
                <span className="font-mono text-sm text-brass">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-3 font-display text-2xl text-ink">{w.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{w.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="identity" className="mt-14 scroll-mt-8 rounded-2xl border border-line bg-surface p-6 sm:p-8">
          <h2 className="font-display text-3xl text-ink sm:text-4xl">Optional: proving who you are, without showing your Aadhaar</h2>
          <p className="mt-3 max-w-3xl text-ink-2">
            People can verify that they hold a valid Aadhaar using a zero-knowledge proof. Owners can then require it. Everything about it is opt-in.
          </p>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {[
              ["The Aadhaar never leaves your browser", "The QR code is read locally and the proof is generated on your device. Heirloom's server never receives it."],
              ["One person, one wallet", "A verified wallet is tied to a pseudonym, and a pseudonym can be tied to only one wallet, so a person cannot hold several guardian seats."],
              ["Proofs cannot be borrowed", "Each proof is bound to the wallet, the chain and the specific purpose. A proof copied from the network is useless to anyone else, and one made for a claim cannot be reused for another."],
              ["Only what is asked is proven", "For an adult check the only fact revealed is \"over 18\". No date of birth is stored. Proofs must be recent (at most 3 hours old)."],
            ].map(([t, b]) => (
              <li key={t} className="border-t border-line-strong pt-3"><p className="font-display text-xl text-ink">{t}</p><p className="mt-1 text-sm leading-relaxed text-ink-2">{b}</p></li>
            ))}
          </ul>
        </section>

        <section className="mt-14">
          <h2 className="font-display text-3xl text-ink sm:text-4xl">What this does not protect</h2>
          <p className="mt-2 max-w-3xl text-ink-2">Being straight about the limits matters more than a clean claim.</p>
          <dl className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-2">
            {LIMITS.map((l) => (
              <div key={l.title} className="border-t border-line-strong pt-4"><dt className="font-display text-xl text-ink">{l.title}</dt><dd className="mt-1 text-sm leading-relaxed text-ink-2">{l.body}</dd></div>
            ))}
          </dl>
        </section>

        <section id="recovery" className="mt-14 scroll-mt-8 rounded-2xl border border-line bg-surface p-6 sm:p-8">
          <h2 className="font-display text-3xl text-ink sm:text-4xl">If you lose your encryption password</h2>
          <div className="mt-4 space-y-4 text-ink-2">
            <p>
              <b className="text-ink">Nobody can reset it, by design.</b> The password seals your private key, and the sealed key is all that the server (and your recovery file) holds. A reset
              feature would need a copy of your key that Heirloom could open, which is exactly what this system avoids.
            </p>
            <p><b className="text-ink">What you can do today:</b></p>
            <ul className="list-disc space-y-1.5 pl-6">
              <li><b className="text-ink">Use a recovery file.</b> On the unlock screen choose &ldquo;Use a recovery file instead&rdquo;. Each file keeps the password it was created with, so pick one whose password you remember. This also restores your key if it was lost from the server or you are on a new device.</li>
              <li><b className="text-ink">Change your password while you still know it</b> (Account page). The new password applies to the stored key; download a fresh recovery file afterwards.</li>
              <li><b className="text-ink">Your inheritance keeps working.</b> Guardians hold their own shares, so a claim can still be approved and released to your beneficiary without your password.</li>
            </ul>
            <p>
              <b className="text-ink">What you would lose with no password and no recovery file:</b> the ability to open your own copy of a file, or to re-share files after replacing guardians, because
              those need your key. Files already reserved stay safe and releasable by the guardians.
            </p>
            <div className="rounded-xl bg-brass-soft/70 p-4">
              <p className="font-display text-xl text-ink">Future work: guardian-assisted recovery</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">
                Not built yet. The idea: you register a new encryption key from your wallet, then your guardians (at their threshold) each re-encrypt their share of a file&apos;s key to your
                new key, after a waiting period during which the old key can still cancel the request. You rebuild each file key locally and regain control without anyone seeing a plaintext.
                It needs a new contract path (a recovery request with its own challenge window and the same fraud flag) and careful abuse analysis, so it is documented here rather than shipped.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
