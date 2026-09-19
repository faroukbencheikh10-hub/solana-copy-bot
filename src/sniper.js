import fetch from 'node-fetch';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { config, SOL_MINT } from './config.js';
import { connection, loadMyKeypair } from './wallet.js';
import { checkLiquidity, getQuote, executeSwap } from './jupiter.js';

// ============================================================
// SNIPER: cerca da solo monete Solana nate da poco (pump.fun) e
// ci fa trade in autonomia, IN PARALLELO al copy trading di index.js.
// Ha una sua posizione separata (heldToken), indipendente da quella
// del copy trading, cosi' le due strategie non si "pestano i piedi"
// a vicenda nel codice. NB: usano pero' lo stesso wallet/saldo SOL,
// quindi se sono entrambe attive possono competere per lo stesso budget.
// ============================================================

const PUMPFUN_NEW_COINS_URL = 'https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false';

// Eta' massima (in millisecondi) di una moneta per essere considerata "nuova"
const MAX_AGE_MS = (config.sniperMaxAgeMinutes ?? 60) * 60 * 1000;

const keypair = loadMyKeypair();

// mint del token attualmente posseduto dallo sniper, o null se libero
let heldToken = null;
// mint gia' controllati e scartati, per non ricontrollarli ad ogni giro
const seenMints = new Set();

console.log('=== Sniper: caccia a monete nuove su Solana ===');
console.log(`Eta' massima moneta: ${(MAX_AGE_MS / 60000).toFixed(0)} minuti`);
console.log('================================================\n');

async function getMySolBalance() {
    const lamports = await connection.getBalance(keypair.publicKey);
    return lamports / LAMPORTS_PER_SOL;
}

// Va a prendere le monete create da poco su pump.fun
async function fetchNewCoins() {
    try {
          const res = await fetch(PUMPFUN_NEW_COINS_URL);
          if (!res.ok) throw new Error(`pump.fun ha risposto ${res.status}`);
          return await res.json();
    } catch (err) {
          console.error('Errore nel recuperare le nuove monete:', err.message);
          return [];
    }
}

// Decide se una moneta merita di essere comprata
function isCandidate(coin) {
    if (!coin?.mint) return false;
    if (seenMints.has(coin.mint)) return false;

  const createdMs = (coin.created_timestamp ?? 0) * 1000;
    const ageMs = Date.now() - createdMs;
    if (ageMs > MAX_AGE_MS || ageMs < 0) return false;

  // Scarta monete gia' "completate" (migrate fuori da pump.fun) se il campo esiste
  if (coin.complete === true) return false;

  return true;
}

async function snipeBuy(mint, symbol) {
    if (heldToken) {
          console.log(`  -> SALTATO: lo sniper ha gia' una posizione aperta su ${heldToken}`);
          return;
    }

  const liquidity = await checkLiquidity(mint);
    if (liquidity < config.minLiquidityUsd) {
          console.log(`  -> SALTATO: liquidita' troppo bassa ($${liquidity.toFixed(0)}) per ${symbol || mint}`);
          return;
    }

  const balance = await getMySolBalance();
    const feeMargin = 0.01;
    const amountSol = Math.max(balance - feeMargin, 0);
    if (amountSol <= 0) {
          console.log('  -> SALTATO: saldo insufficiente per comprare');
          return;
    }
    const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

  console.log(`  -> SNIPE BUY: ${amountSol.toFixed(4)} SOL su ${symbol || mint} (${mint})`);
    try {
          const quote = await getQuote(SOL_MINT, mint, amountLamports);
          const sig = await executeSwap(quote, keypair);
          heldToken = mint;
          console.log(`  -> Fatto! Tx: https://solscan.io/tx/${sig}`);
    } catch (err) {
          console.error('  -> Errore durante lo snipe buy:', err.message);
    }
}

async function snipeSell() {
    if (!heldToken) return;
    if (!config.copySell) {
          // Riusiamo lo stesso interruttore COPY_SELL anche per lo sniper:
      // se e' disattivato, lo sniper compra ma non rivende da solo.
      return;
    }

  try {
        const { PublicKey } = await import('@solana/web3.js');
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(keypair.publicKey, {
                mint: new PublicKey(heldToken),
        });
        if (tokenAccounts.value.length === 0) {
                heldToken = null;
                return;
        }
        const rawAmount = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.amount;
        if (rawAmount === '0') {
                heldToken = null;
                return;
        }

      console.log(`  -> SNIPE SELL: tutto il saldo di ${heldToken}`);
        const quote = await getQuote(heldToken, SOL_MINT, rawAmount);
        const sig = await executeSwap(quote, keypair);
        heldToken = null;
        console.log(`  -> Fatto! Tx: https://solscan.io/tx/${sig}`);
  } catch (err) {
        console.error('  -> Errore durante lo snipe sell:', err.message);
  }
}

async function sniperLoop() {
    // Se abbiamo gia' una posizione aperta, per ora ci limitiamo a lasciarla
  // li' (la vendita automatica con un target di profitto si puo' aggiungere
  // in seguito). Continuiamo comunque a cercare nuove monete da segnare come "viste".
  const coins = await fetchNewCoins();
    for (const coin of coins) {
          if (!coin?.mint) continue;
          if (seenMints.has(coin.mint)) continue;

      if (isCandidate(coin)) {
              console.log(`[Sniper] Nuova moneta trovata: ${coin.symbol || '?'} (${coin.mint})`);
              seenMints.add(coin.mint);
              await snipeBuy(coin.mint, coin.symbol);
      } else {
              seenMints.add(coin.mint);
      }
    }
}

// Avvia lo sniper: da chiamare da index.js insieme a pollLoop() del copy trading
export function startSniper() {
    const intervalMs = (config.sniperPollIntervalSeconds ?? config.pollIntervalSeconds ?? 10) * 1000;
    setInterval(sniperLoop, intervalMs);
    setInterval(snipeSell, intervalMs);
    sniperLoop();
}
