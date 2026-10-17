// node traders.mjs — long-running market-making noise traders.
// Each new window k: every bot with free vault funds commits a random order for batch k.
// In window k+1 all non-griefers reveal; the first GRIEFERS bots never reveal (lose their bond).
// The keeper (keeper.mjs) settles and claims, which frees the vault funds for the next round.
import { pub, read, params, windowAt, commitHash, randomSalt, receipt, log, fmt, sleep,
  BOT_COUNT, MID_TICK, GRIEFERS, POLL_MS } from './config.mjs';
import { botWallet } from './keys.mjs';

const bots = Array.from({ length: BOT_COUNT }, (_, i) => Object.assign(botWallet(i), {
  idx: i, griefer: i < GRIEFERS, open: null,
}));
const p = await params();
let mid = MID_TICK;
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

log(`traders: ${BOT_COUNT} bots (${GRIEFERS} griefers), window=${p.windowBlocks} blocks, mid=${mid}`);

function track(bot, what, hashP) {
  hashP.then(async (h) => {
    const r = await receipt(h);
    if (r.status !== 'success') log(`  ${bot.label} ${what} REVERTED ${h}`);
  }).catch((e) => log(`  ${bot.label} ${what} send failed: ${e.shortMessage || e.message}`));
}

// last block offset inside a window at which we still send (leave room for inclusion)
const GUARD = p.windowBlocks - (p.windowBlocks / 4n > 2n ? p.windowBlocks / 4n : 2n);

function revealDue(k) {
  for (const bot of bots) {
    const o = bot.open;
    if (o && o.batch === k - 1n && !o.revealSent && !bot.griefer) {
      o.revealSent = true;
      track(bot, `reveal#${o.batch}`, bot.write('reveal', [bot.address, o.batch, o.isBuy, o.qty, o.tick, o.salt]));
      log(`${bot.label} reveal#${o.batch} ${o.isBuy ? 'BUY ' : 'SELL'} ${fmt(o.qty)}@${o.tick}`);
    }
  }
}

async function commitRound(k) {
  mid = clamp(mid + rnd(-1, 1), MID_TICK - 8, MID_TICK + 8);
  const lines = [];
  await Promise.all(bots.map(async (bot) => {
    const o = bot.open;
    if (o && o.batch === k) return;
    // funds are free only after the keeper claimed our previous order (commit locks the whole vault)
    const [fb, fq] = await Promise.all([read('freeBase', [bot.address]), read('freeQuote', [bot.address])]);
    if (fq < p.bond) return;
    const lockQ = fq - p.bond;
    const qty = BigInt(rnd(1, 20)) * 10n ** 17n; // 0.1 .. 2.0 SBA
    const tick = clamp(mid + rnd(-6, 6), 0, 40);
    const cost = (qty * (90n * 10n ** 18n + 5n * 10n ** 17n * BigInt(tick)) + 10n ** 18n - 1n) / 10n ** 18n;
    let isBuy = Math.random() < 0.5;
    if (!isBuy && qty > fb) isBuy = true;
    if (isBuy && cost > lockQ) { if (qty <= fb) isBuy = false; else return; }
    const salt = randomSalt();
    bot.open = { batch: k, isBuy, qty, tick, salt, revealSent: false };
    track(bot, `commit#${k}`, bot.write('commit', [bot.address, k, commitHash(k, bot.address, isBuy, qty, tick, salt)]));
    lines.push(`${bot.label}${bot.griefer ? '(griefer)' : ''} ${isBuy ? 'BUY ' : 'SELL'} ${fmt(qty)}@${tick}`);
  }));
  log(`window ${k} mid=${mid} commits: ${lines.join(' | ') || 'none (funds still locked)'}`);
}

let lastWindow = -1n;
for (;;) {
  try {
    const bn = await pub.getBlockNumber();
    const { window, offset } = await windowAt(bn);
    if (offset <= GUARD) {
      revealDue(window);
      if (window !== lastWindow) { lastWindow = window; await commitRound(window); }
    }
  } catch (e) {
    log('loop error', e.shortMessage || e.message);
  }
  await sleep(POLL_MS);
}
