import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { config, SOL_MINT } from './config.js';
import { connection, loadMyKeypair } from './wallet.js';
import { classifySwap } from './detect.js';
import { checkLiquidity, getQuote, executeSwap } from './jupiter.js';
import { findFreshTokens, getCurrentPriceUsd, markTried } from './sniper.js';
import * as state from './state.js';
import { startControlServer } from './controlServer.js';

const keypair = loadMyKeypair();

// Stato indipendente per ogni wallet copiato: ultima transazione vista
const targets = config.targetWallets.map((address) => ({
  address,
  pubkey: new PublicKey(address),
  lastSignature: null,
}));

// Il bot tiene UNA posizione alla volta: appena compra un token (copiando uno dei
// wallet seguiti), si "blocca" su quel token e ignora gli acquisti degli altri
// wallet finche' non lo rivende. Cosi' puo' usare sempre tutto il budget disponibile.
// Lo stato (posizione aperta, acceso/spento) vive in state.js cosi' che anche il
// server di controllo possa leggerlo e modificarlo (bottone ON/OFF della dashboard).

console.log('=== Solana Copy Trading Bot ===');
console.log(`Copio da ${targets.length} wallet (un trade alla volta, tutto il budget su quello attivo):`);
for (const t of targets) console.log(' -', t.address);
console.log('Sniping monete nuove attivo:', config.snipeEnabled);
if (config.snipeEnabled) {
  console.log(` - eta' massima: ${config.snipeMaxAgeMinutes} min, liquidita' minima: $${config.snipeMinLiquidityUsd}, take profit: +${config.snipeTakeProfitPercent}%, stop loss: -${config.snipeStopLossPercent}%`);
}
console.log('Il mio wallet:', keypair.publicKey.toBase58());
console.log('Copy sell attivo:', config.copySell);
console.log('================================\n');

async function getMySolBalance() {
  const lamports = await connection.getBalance(keypair.publicKey);
  return lamports / LAMPORTS_PER_SOL;
}

async function copyBuy(tokenMint, fromWallet) {
  if (!state.isEnabled()) {
    console.log(' -> SALTATO: bot in pausa (spento dalla dashboard)');
    return;
  }

  const { heldToken } = state.getHeld();
  if (heldToken) {
    console.log(` -> SALTATO: il bot ha gia' una posizione aperta su ${heldToken} (in attesa che venga chiusa)`);
    return;
  }

  const liquidity = await checkLiquidity(tokenMint);
  if (liquidity < config.minLiquidityUsd) {
    console.log(` -> SALTATO: liquidita' troppo bassa ($${liquidity.toFixed(0)}) per ${tokenMint}`);
    return;
  }

  // Usa TUTTO il saldo SOL disponibile (meno un margine per le fee di rete)
  const balance = await getMySolBalance();
  const feeMargin = 0.01;
  const amountSol = Math.max(balance - feeMargin, 0);
  if (amountSol <= 0) {
    console.log(' -> SALTATO: saldo insufficiente per comprare');
    return;
  }
  const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

  console.log(` -> COPIO BUY (da ${fromWallet}): ${amountSol.toFixed(4)} SOL su ${tokenMint}`);
  try {
    const quote = await getQuote(SOL_MINT, tokenMint, amountLamports);
    const sig = await executeSwap(quote, keypair);
    state.setHeld(tokenMint, 'copy', null); // blocca il bot su questa posizione
    state.setLastAction({ type: 'copy_buy', tokenMint, fromWallet, amountSol, tx: sig });
    console.log(` -> Fatto! Tx: https://solscan.io/tx/${sig}`);
  } catch (err) {
    console.error(' -> Errore durante il buy:', err.message);
  }
}

async function snipeBuy(candidate) {
  if (!state.isEnabled()) return;

  const { heldToken } = state.getHeld();
  if (heldToken) {
    return; // gia' impegnato su un'altra posizione (copy o snipe)
  }

  console.log(`[SNIPE] Candidata trovata: ${candidate.symbol} (${candidate.mint})`);
  console.log(` - eta': ${candidate.ageMinutes.toFixed(1)} min, liquidita': $${candidate.liquidityUsd.toFixed(0)}, volume 1h: $${candidate.volumeH1Usd.toFixed(0)}`);

  const balance = await getMySolBalance();
  const feeMargin = 0.01;
  const amountSol = Math.max(balance - feeMargin, 0);
  if (amountSol <= 0) {
    console.log(' -> SALTATO: saldo insufficiente per comprare');
    markTried(candidate.mint);
    return;
  }
  const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

  console.log(` -> SNIPE BUY: ${amountSol.toFixed(4)} SOL su ${candidate.symbol}`);
  try {
    const quote = await getQuote(SOL_MINT, candidate.mint, amountLamports);
    const sig = await executeSwap(quote, keypair);
    state.setHeld(candidate.mint, 'snipe', candidate.priceUsd);
    state.setLastAction({ type: 'snipe_buy', tokenMint: candidate.mint, symbol: candidate.symbol, amountSol, tx: sig });
    markTried(candidate.mint);
    console.log(` -> Fatto! Tx: https://solscan.io/tx/${sig}`);
  } catch (err) {
    console.error(' -> Errore durante lo snipe buy (probabilmente non ancora scambiabile su Jupiter):', err.message);
    markTried(candidate.mint);
  }
}

async function sellHeldPosition(reason) {
  const { heldToken } = state.getHeld();
  try {
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(keypair.publicKey, {
      mint: new PublicKey(heldToken),
    });
    if (tokenAccounts.value.length === 0) {
      console.log(' -> Non possiedo questo token, niente da vendere');
      state.clearHeld();
      return;
    }
    const amount = tokenAccounts.value[0].account.data.parsed.info.tokenAmount;
    const rawAmount = amount.amount;
    if (rawAmount === '0') {
      state.clearHeld();
      return;
    }

    console.log(` -> VENDO (${reason}): tutto il saldo di ${heldToken}`);
    const quote = await getQuote(heldToken, SOL_MINT, rawAmount);
    const sig = await executeSwap(quote, keypair);
    state.setLastAction({ type: 'sell', tokenMint: heldToken, reason, tx: sig });
    console.log(` -> Fatto! Tx: https://solscan.io/tx/${sig}`);
  } catch (err) {
    console.error(' -> Errore durante la vendita:', err.message);
  } finally {
    state.clearHeld();
  }
}

async function checkSnipeExit() {
  const { heldToken, heldFrom, entryPriceUsd } = state.getHeld();
  if (heldFrom !== 'snipe' || !heldToken || !entryPriceUsd) return;
  const currentPrice = await getCurrentPriceUsd(heldToken);
  if (!currentPrice) return;

  const changePercent = ((currentPrice - entryPriceUsd) / entryPriceUsd) * 100;
  if (changePercent >= config.snipeTakeProfitPercent) {
    console.log(`[SNIPE] Take profit raggiunto: +${changePercent.toFixed(1)}%`);
    await sellHeldPosition(`take profit +${changePercent.toFixed(1)}%`);
  } else if (changePercent <= -config.snipeStopLossPercent) {
    console.log(`[SNIPE] Stop loss raggiunto: ${changePercent.toFixed(1)}%`);
    await sellHeldPosition(`stop loss ${changePercent.toFixed(1)}%`);
  }
}

async function snipeLoop() {
  if (!config.snipeEnabled) return;
  const { heldToken } = state.getHeld();
  if (heldToken) {
    // Il bot ha gia' una posizione: controlla solo se e' il momento di vendere
    // (la vendita di chiusura resta attiva anche a bot "in pausa")
    await checkSnipeExit();
    return;
  }
  if (!state.isEnabled()) return;
  try {
    const candidates = await findFreshTokens();
    for (const candidate of candidates) {
      if (state.getHeld().heldToken) break; // un'altra parte del bot ha appena comprato qualcosa
      await snipeBuy(candidate);
    }
  } catch (err) {
    console.error('[SNIPE] Errore nel loop:', err.message);
  }
}

async function copySell(tokenMint, fromWallet) {
  if (!config.copySell) {
    console.log(' -> Copy sell disattivato, ignoro la vendita');
    return;
  }
  const { heldToken, heldFrom } = state.getHeld();
  if (heldToken !== tokenMint || heldFrom !== 'copy') {
    // Non e' il token che il bot possiede da copy trading (o non possiede nulla): niente da fare
    return;
  }
  console.log(` -> COPIO SELL (da ${fromWallet})`);
  await sellHeldPosition(`copiato da ${fromWallet}`);
}

async function pollTarget(target) {
  const signatures = await connection.getSignaturesForAddress(target.pubkey, { limit: 10 });
  if (signatures.length === 0) return;

  if (target.lastSignature === null) {
    target.lastSignature = signatures[0].signature;
    console.log(`[${target.address}] Monitoraggio avviato da adesso.`);
    return;
  }

  const newOnes = [];
  for (const s of signatures) {
    if (s.signature === target.lastSignature) break;
    newOnes.push(s.signature);
  }
  if (newOnes.length === 0) return;

  newOnes.reverse();
  target.lastSignature = signatures[0].signature;

  for (const sig of newOnes) {
    console.log(`[${target.address}] Nuova transazione: ${sig}`);
    const swap = await classifySwap(sig, target.address);
    if (!swap) {
      console.log(' -> Non e\' uno swap riconosciuto, ignoro');
      continue;
    }
    if (swap.type === 'BUY') {
      console.log(` -> Ha COMPRATO ${swap.tokenMint}`);
      await copyBuy(swap.tokenMint, target.address);
    } else if (swap.type === 'SELL') {
      console.log(` -> Ha VENDUTO ${swap.tokenMint}`);
      await copySell(swap.tokenMint, target.address);
    }
  }
}

async function pollLoop() {
  for (const target of targets) {
    try {
      await pollTarget(target);
    } catch (err) {
      console.error(`[${target.address}] Errore nel loop:`, err.message);
    }
  }
}

setInterval(pollLoop, config.pollIntervalSeconds * 1000);
pollLoop();

if (config.snipeEnabled) {
  setInterval(snipeLoop, config.snipePollIntervalSeconds * 1000);
  snipeLoop();
}

// Server di controllo (stato + ON/OFF), usato dalla dashboard.
startControlServer(getMySolBalance);
