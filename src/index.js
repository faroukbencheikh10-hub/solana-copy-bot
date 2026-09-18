import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { config, SOL_MINT } from './config.js';
import { connection, loadMyKeypair } from './wallet.js';
import { classifySwap } from './detect.js';
import { checkLiquidity, getQuote, executeSwap } from './jupiter.js';

const keypair = loadMyKeypair();
const targetPubkey = new PublicKey(config.targetWallet);

console.log('=== Solana Copy Trading Bot ===');
console.log('Copio da:', config.targetWallet);
console.log('Il mio wallet:', keypair.publicKey.toBase58());
console.log('Modalita budget: USA TUTTO IL SALDO DISPONIBILE ad ogni trade (rischio massimo)');
console.log('Copy sell attivo:', config.copySell);
console.log('================================\n');

let lastSignature = null;

async function getMySolBalance() {
  const lamports = await connection.getBalance(keypair.publicKey);
  return lamports / LAMPORTS_PER_SOL;
}

async function copyBuy(tokenMint) {
  const liquidity = await checkLiquidity(tokenMint);
  if (liquidity < config.minLiquidityUsd) {
    console.log(`  -> SALTATO: liquidita' troppo bassa ($${liquidity.toFixed(0)}) per ${tokenMint}`);
    return;
  }

  // Usa TUTTO il saldo SOL disponibile (meno un margine per le fee di rete)
  const balance = await getMySolBalance();
  const feeMargin = 0.01; // margine per fee/rent
  const amountSol = Math.max(balance - feeMargin, 0);
  if (amountSol <= 0) {
    console.log('  -> SALTATO: saldo insufficiente per comprare');
    return;
  }
  const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

  console.log(`  -> COPIO BUY: ${amountSol.toFixed(4)} SOL su ${tokenMint}`);
  try {
    const quote = await getQuote(SOL_MINT, tokenMint, amountLamports);
    const sig = await executeSwap(quote, keypair);
    console.log(`  -> Fatto! Tx: https://solscan.io/tx/${sig}`);
  } catch (err) {
    console.error('  -> Errore durante il buy:', err.message);
  }
}

async function copySell(tokenMint) {
  if (!config.copySell) {
    console.log('  -> Copy sell disattivato, ignoro la vendita');
    return;
  }
  try {
    // Vende TUTTO il saldo che ho di quel token
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(keypair.publicKey, {
      mint: new PublicKey(tokenMint),
    });
    if (tokenAccounts.value.length === 0) {
      console.log('  -> Non possiedo questo token, niente da vendere');
      return;
    }
    const amount = tokenAccounts.value[0].account.data.parsed.info.tokenAmount;
    const rawAmount = amount.amount; // gia' in unita' minime
    if (rawAmount === '0') {
      console.log('  -> Saldo del token e\' zero, niente da vendere');
      return;
    }

    console.log(`  -> COPIO SELL: tutto il saldo di ${tokenMint}`);
    const quote = await getQuote(tokenMint, SOL_MINT, rawAmount);
    const sig = await executeSwap(quote, keypair);
    console.log(`  -> Fatto! Tx: https://solscan.io/tx/${sig}`);
  } catch (err) {
    console.error('  -> Errore durante il sell:', err.message);
  }
}

async function pollLoop() {
  try {
    const signatures = await connection.getSignaturesForAddress(targetPubkey, { limit: 10 });
    if (signatures.length === 0) return;

    if (lastSignature === null) {
      // Prima esecuzione: non copiare la storia passata, solo da adesso in poi
      lastSignature = signatures[0].signature;
      console.log('Bot avviato. Da ora monitoro le nuove operazioni del wallet target.\n');
      return;
    }

    const newOnes = [];
    for (const s of signatures) {
      if (s.signature === lastSignature) break;
      newOnes.push(s.signature);
    }
    if (newOnes.length === 0) return;

    newOnes.reverse(); // esegui in ordine cronologico
    lastSignature = signatures[0].signature;

    for (const sig of newOnes) {
      console.log(`Nuova transazione rilevata: ${sig}`);
      const swap = await classifySwap(sig, config.targetWallet);
      if (!swap) {
        console.log('  -> Non e\' uno swap riconosciuto, ignoro');
        continue;
      }
      if (swap.type === 'BUY') {
        console.log(`  -> Il wallet target ha COMPRATO ${swap.tokenMint}`);
        await copyBuy(swap.tokenMint);
      } else if (swap.type === 'SELL') {
        console.log(`  -> Il wallet target ha VENDUTO ${swap.tokenMint}`);
        await copySell(swap.tokenMint);
      }
    }
  } catch (err) {
    console.error('Errore nel loop principale:', err.message);
  }
}

setInterval(pollLoop, config.pollIntervalSeconds * 1000);
pollLoop();
