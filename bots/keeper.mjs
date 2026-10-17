// node keeper.mjs [--once] [--pause] [--from <block>]
//   loop: batches with commits>0 → phase 2 settle, phase 3 cancel, settled/cancelled → claim every committer.
//   --once   single pass then exit
//   --pause  simulate "keeper down": exits immediately. To demo the timeout path just stop the keeper
//            (Ctrl-C / --pause) and wait timeoutWindows windows; then anyone can cancel() (or run keeper again).
//   --from   start scanning Committed logs from this block (default: genesisBlock; on Monad pass a recent block)
import { pub, read, params, Wallet, KEEPER_PK, receipt, getLogsChunked, log, sleep, POLL_MS, PHASE } from './config.mjs';

const argv = process.argv.slice(2);
if (argv.includes('--pause')) {
  log('keeper paused (simulated outage) — not settling. Batches will become cancellable after timeoutWindows.');
  process.exit(0);
}
const once = argv.includes('--once');
const fi = argv.indexOf('--from');
const p = await params();
const keeper = new Wallet(KEEPER_PK, 'keeper');
const head0 = await pub.getBlockNumber();
// default: from genesis, but at most LOOKBACK blocks back (public RPC friendliness)
const LOOKBACK = BigInt(process.env.KEEPER_LOOKBACK || 3000);
let scanned = fi >= 0 ? BigInt(argv[fi + 1]) - 1n
  : (head0 - p.genesisBlock > LOOKBACK ? head0 - LOOKBACK : p.genesisBlock - 1n);
const batches = new Map(); // id -> { committers:Set, claimed:Set, done:bool }

log(`keeper ${keeper.address} window=${p.windowBlocks} timeout=${p.timeoutWindows}`);

async function pass() {
  const head = await pub.getBlockNumber();
  if (head > scanned) {
    for (const l of await getLogsChunked('Committed', scanned + 1n, head)) {
      const id = l.args.batchId;
      if (!batches.has(id)) batches.set(id, { committers: new Set(), claimed: new Set(), done: false });
      batches.get(id).committers.add(l.args.owner);
    }
    scanned = head;
  }
  for (const [id, b] of batches) {
    if (b.done) continue;
    let ph = Number(await read('phaseOf', [id]));
    if (ph === 2 || ph === 3) {
      const fn = ph === 2 ? 'settle' : 'cancel';
      try {
        const h = await keeper.write(fn, [id]);
        const r = await receipt(h);
        log(`${fn}#${id} ${r.status} gasUsed=${r.gasUsed} ${h}`);
      } catch (e) { log(`${fn}#${id} failed: ${e.shortMessage || e.message}`); }
      ph = Number(await read('phaseOf', [id]));
    }
    if (ph === 4 || ph === 5) {
      const todo = [];
      for (const owner of b.committers) {
        if (b.claimed.has(owner)) continue;
        const o = await read('getOrder', [id, owner]);
        if (o.claimed) { b.claimed.add(owner); continue; }
        todo.push(keeper.write('claim', [owner, id]).then(async (h) => {
          const r = await receipt(h);
          if (r.status === 'success') b.claimed.add(owner);
          return `${owner.slice(0, 8)}:${r.status === 'success' ? 'ok' : 'REVERT'}`;
        }).catch((e) => `${owner.slice(0, 8)}:ERR ${e.shortMessage || e.message}`));
      }
      if (todo.length) log(`claim#${id} (${PHASE[ph]}) ${(await Promise.all(todo)).join(' ')}`);
      if (b.claimed.size === b.committers.size) b.done = true;
    }
  }
}

do {
  try { await pass(); } catch (e) { log('keeper error', e.shortMessage || e.message); }
  if (!once) await sleep(Math.max(POLL_MS, 500));
} while (!once);
