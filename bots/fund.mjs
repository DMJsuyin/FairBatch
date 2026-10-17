// node fund.mjs            — fund trader bots 0..BOT_COUNT-1 with MON and onboard them into the vault
// (also exported: fundAndOnboard(wallets) used by scenario.mjs)
import { parseEther } from 'viem';
import { pub, read, Wallet, FUNDER_PK, BOT_COUNT, BOT_MON, receipt, log, fmt } from './config.mjs';
import { botWallet } from './keys.mjs';

export async function fundAndOnboard(wallets) {
  const funder = new Wallet(FUNDER_PK, 'funder');
  const amt = parseEther(BOT_MON);
  const fundTx = [];
  for (const w of wallets) {
    const bal = await pub.getBalance({ address: w.address });
    if (bal < amt / 2n) fundTx.push(funder.transfer(w.address, amt).then((h) => ({ w, h })));
  }
  for (const { w, h } of await Promise.all(fundTx)) {
    const r = await receipt(h);
    log(`fund ${w.label} ${w.address} +${BOT_MON} MON ${r.status} ${h}`);
  }
  const ob = [];
  for (const w of wallets) {
    const [fb, fq] = await Promise.all([read('freeBase', [w.address]), read('freeQuote', [w.address])]);
    if (fb > 0n || fq > 0n) { log(`skip onboard ${w.label}: vault ${fmt(fb)} SBA / ${fmt(fq)} SUSD`); continue; }
    ob.push(w.write('onboard', ['0x0000000000000000000000000000000000000000']).then((h) => ({ w, h })));
  }
  for (const { w, h } of await Promise.all(ob)) {
    const r = await receipt(h);
    log(`onboard ${w.label} ${r.status} ${h}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bots = Array.from({ length: BOT_COUNT }, (_, i) => botWallet(i));
  await fundAndOnboard(bots);
  log('done');
}
