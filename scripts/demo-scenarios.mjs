/**
 * Drives all five demo scenarios through the real UI with a real browser.
 * Every assertion is made against on-screen text, not internal state.
 *
 *   node scripts/demo-scenarios.mjs            # headless
 *   node scripts/demo-scenarios.mjs --shots    # also write screenshots
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:3001/';
const SHOTS = process.argv.includes('--shots');
const SHOT_DIR = process.env.SHOT_DIR || './.shots';
if (SHOTS) mkdirSync(SHOT_DIR, { recursive: true });

let pass = 0;
let fail = 0;
const check = (label, ok, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  ok ? pass++ : fail++;
};

/* ── helpers that act the way a user does ─────────────────────────────── */

const text = (page) => page.evaluate(() => document.body.innerText);

async function clickText(page, label, { exact = false, nth = 0 } = {}) {
  const handle = await page.evaluateHandle(
    (label, exact, nth) => {
      const els = [...document.querySelectorAll('button, a')].filter((el) => {
        const t = (el.innerText || '').trim();
        return exact ? t === label : t.includes(label);
      });
      return els[nth] || null;
    },
    label,
    exact,
    nth,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`no clickable element matching "${label}"`);
  const disabled = await el.evaluate((e) => e.disabled === true);
  if (disabled) throw new Error(`element "${label}" is disabled`);
  await el.click();
  await new Promise((r) => setTimeout(r, 220));
}

async function isDisabled(page, label) {
  return page.evaluate((label) => {
    const el = [...document.querySelectorAll('button')].find((b) =>
      (b.innerText || '').trim().includes(label),
    );
    return el ? el.disabled === true : null;
  }, label);
}

async function tab(page, name) {
  await clickText(page, name, { exact: true });
}

async function fill(page, placeholderFragment, value) {
  await page.evaluate(
    (frag, val) => {
      const input = [...document.querySelectorAll('input')].find((i) =>
        (i.placeholder || '').toLowerCase().includes(frag.toLowerCase()),
      );
      if (!input) throw new Error(`no input with placeholder ~ "${frag}"`);
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      ).set;
      setter.call(input, val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    placeholderFragment,
    value,
  );
  await new Promise((r) => setTimeout(r, 260));
}

const stateBadge = (page) =>
  page.evaluate(() => {
    const m = document.body.innerText.match(/\b(ACTIVE|RECOVERY PENDING|RELEASED|CLAIMED)\b/);
    return m ? m[1] : null;
  });

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true });
}

async function reset(page) {
  await clickText(page, 'Reset to initial state');
  await new Promise((r) => setTimeout(r, 900)); // re-seeding regenerates real keys
}

/** Drive ACTIVE -> RECOVERY_PENDING using only legal moves. */
async function openRecovery(page, guardianIds = [0, 1, 2]) {
  await clickText(page, 'Fast-forward past heartbeat');
  await tab(page, 'Guardian');
  for (const i of guardianIds) await clickText(page, 'Attest unavailable', { nth: 0 });
  return stateBadge(page);
}

/* ── scenarios ────────────────────────────────────────────────────────── */

async function scenario1(page) {
  console.log('\n[1] Normal recovery — heartbeat missed, 3 attest, window expires, heir claims');
  await reset(page);

  await clickText(page, 'Fast-forward past heartbeat');
  check('still ACTIVE on missed heartbeat alone', (await stateBadge(page)) === 'ACTIVE');

  await tab(page, 'Guardian');
  await clickText(page, 'Attest unavailable', { nth: 0 });
  await clickText(page, 'Attest unavailable', { nth: 0 });
  check('still ACTIVE after 2 of 3 attestations', (await stateBadge(page)) === 'ACTIVE');

  await clickText(page, 'Attest unavailable', { nth: 0 });
  check(
    'RECOVERY_PENDING once both signals hold',
    (await stateBadge(page)) === 'RECOVERY PENDING',
  );

  await clickText(page, 'Fast-forward past challenge window');
  check('RELEASED after window expiry', (await stateBadge(page)) === 'RELEASED');

  for (let i = 0; i < 3; i++) await clickText(page, 'Release my share', { nth: 0 });
  check('3 shares published', (await text(page)).includes('3 / 3'));

  await tab(page, 'Heir');
  await clickText(page, 'Load legitimate heir');
  await clickText(page, 'Claim & decrypt');
  await new Promise((r) => setTimeout(r, 600));

  const body = await text(page);
  check('state is CLAIMED', (await stateBadge(page)) === 'CLAIMED');
  check('asset decrypted and displayed', body.includes('HEIRLOOM — SEALED LETTER'));
  check('seed phrase recovered verbatim', body.includes('abandon ability able about'));
  await shot(page, '1-normal-recovery');
}

async function scenario2(page) {
  console.log('\n[2] Early claim blocked — in ACTIVE and in RECOVERY_PENDING');
  await reset(page);

  await tab(page, 'Heir');
  await clickText(page, 'Load legitimate heir');
  check('claim button disabled in ACTIVE', (await isDisabled(page, 'Claim & decrypt')) === true);
  await clickText(page, 'Attempt claim anyway');
  let body = await text(page);
  check(
    'ACTIVE claim rejected with reason',
    body.includes('Claim rejected') && body.includes('not RELEASED'),
    body.match(/vault is \w+/)?.[0],
  );
  await shot(page, '2a-claim-blocked-active');

  await openRecovery(page);
  await tab(page, 'Heir');
  check(
    'claim button disabled in RECOVERY_PENDING',
    (await isDisabled(page, 'Claim & decrypt')) === true,
  );
  await clickText(page, 'Attempt claim anyway');
  body = await text(page);
  check(
    'RECOVERY_PENDING claim rejected with reason',
    body.includes('Claim rejected') && body.includes('RECOVERY_PENDING'),
  );
  check('vault unchanged, still RECOVERY_PENDING', (await stateBadge(page)) === 'RECOVERY PENDING');
  await shot(page, '2b-claim-blocked-pending');
}

async function scenario3(page) {
  console.log('\n[3] Owner cancels during the challenge window');
  await reset(page);
  await openRecovery(page);
  check('RECOVERY_PENDING reached', (await stateBadge(page)) === 'RECOVERY PENDING');

  await tab(page, 'Owner');
  await clickText(page, 'Cancel recovery — I am alive');
  check('back to ACTIVE after cancel', (await stateBadge(page)) === 'ACTIVE');

  const body = await text(page);
  check('cancellation recorded in audit', body.includes('recovery-cancelled'));
  check('attestations cleared', body.includes('0 / 3'));
  await shot(page, '3-owner-cancels');
}

async function scenario4(page) {
  console.log('\n[4] Impostor rejected — valid ID, wrong commitment');
  await reset(page);
  await openRecovery(page);
  await clickText(page, 'Fast-forward past challenge window');
  await tab(page, 'Guardian');
  for (let i = 0; i < 3; i++) await clickText(page, 'Release my share', { nth: 0 });

  await tab(page, 'Heir');
  await clickText(page, 'Load impostor identity');
  const body0 = await text(page);
  const score = Number(body0.match(/\n(\d+)\nthreshold 70/)?.[1] ?? -1);
  check('impostor claim strength below 70', score >= 0 && score < 70, `score ${score}`);
  check('claim button disabled for impostor', (await isDisabled(page, 'Claim & decrypt')) === true);

  await clickText(page, 'Attempt claim anyway');
  const body = await text(page);
  check('impostor rejected on commitment check', body.includes('Commitment check failed'));
  check('vault not claimed', (await stateBadge(page)) === 'RELEASED');
  check('no plaintext leaked', !body.includes('abandon ability able about'));
  await shot(page, '4-impostor-rejected');

  // The legitimate heir still succeeds afterwards.
  await clickText(page, 'Load legitimate heir');
  const body1 = await text(page);
  const score2 = Number(body1.match(/\n(\d+)\nthreshold 70/)?.[1] ?? -1);
  check('legitimate heir clears threshold', score2 >= 70, `score ${score2}`);
  await clickText(page, 'Claim & decrypt');
  await new Promise((r) => setTimeout(r, 600));
  check('legitimate heir recovers the asset', (await text(page)).includes('HEIRLOOM — SEALED LETTER'));
}

async function scenario5(page) {
  console.log('\n[5] Guardians offline — 2 of 5 down, remaining 3 complete recovery');
  await reset(page);
  await clickText(page, 'Dr. Okafor');
  await clickText(page, 'Priya (friend)');
  const offline = await page.evaluate(
    () => (document.body.innerText.match(/OFF/g) || []).length,
  );
  check('2 guardians offline', offline === 2, `${offline} OFF`);

  await clickText(page, 'Fast-forward past heartbeat');
  await tab(page, 'Guardian');
  const attestable = await page.evaluate(
    () =>
      [...document.querySelectorAll('button')].filter(
        (b) => b.innerText.includes('Attest unavailable') && !b.disabled,
      ).length,
  );
  check('only the 3 online guardians can attest', attestable === 3, `${attestable} enabled`);

  for (let i = 0; i < 3; i++) await clickText(page, 'Attest unavailable', { nth: 0 });
  check('recovery opens on 3 of 5', (await stateBadge(page)) === 'RECOVERY PENDING');

  await clickText(page, 'Fast-forward past challenge window');
  for (let i = 0; i < 3; i++) await clickText(page, 'Release my share', { nth: 0 });

  await tab(page, 'Heir');
  await clickText(page, 'Load legitimate heir');
  await clickText(page, 'Claim & decrypt');
  await new Promise((r) => setTimeout(r, 600));
  check('recovery completes with 2 guardians down', (await stateBadge(page)) === 'CLAIMED');
  check('asset decrypted', (await text(page)).includes('HEIRLOOM — SEALED LETTER'));
  await shot(page, '5-guardians-offline');
}

/* ── run ──────────────────────────────────────────────────────────────── */

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1200 });
page.on('pageerror', (e) => console.log('  [page error]', e.message));
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => document.body.innerText.includes('Heartbeat'), { timeout: 60000 });

try {
  await scenario1(page);
  await scenario2(page);
  await scenario3(page);
  await scenario4(page);
  await scenario5(page);
} catch (e) {
  console.log('\n  ABORTED:', e.message);
  fail++;
}

console.log(`\n${'─'.repeat(60)}\n  ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
