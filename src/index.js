import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { config, SOL_MINT } from './config.js';
import { connection, loadMyKeypair } from './wallet.js';
import { classifySwap } from './detect.js';
import { checkLiquidity, getQuote, executeSwap } from './jupiter.js';

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
let heldToken = null; // mint del token attualmente posseduto, o null se libero

console.log('=== Solana Copy Trading Bot ===');
console.log(`Copio da ${targets.length} wallet (un trade alla volta, tutto il budget su quello attivo):`);
for (const t of targets) console.log('  -', t.address);
console.log('Il mio wallet:', keypair.publicKey.toBase58());
console.log('Copy sell attivo:', config.copySell);
console.log('================================\n');

async function getMySolBalance() {
    const lamports = await connection.getBalance(keypair.publicKey);
    return lamports / LAMPORTS_PER_SOL;
}

async function copyBuy(tokenMint, fromWallet) {
    if (heldToken) {
          console.log(`  -> SALTATO: il bot ha gia' una posizione aperta su ${heldToken} (in attesa che venga chiusa)`);
          return;
    }

  const liquidity = await checkLiquidity(tokenMint);
    if (liquidity < config.minLiquidityUsd) {
          console.log(`  -> SALTATO: liquidita' troppo bassa ($${liquidity.toFixed(0)}) per ${tokenMint}`);
          return;
    }

  // Usa TUTTO il saldo SOL disponibile (meno un margine per le fee di rete)
  const balance = await getMySolBalance();
    const feeMargin = 0.01;
    const amountSol = Math.max(balance - feeMargin, 0);
    if (amountSol <= 0) {
          console.log('  -> SALTATO: saldo insufficiente per comprare');
          return;
    }
    const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

  console.log(`  -> COPIO BUY (da ${fromWallet}): ${amountSol.toFixed(4)} SOL su ${tokenMint}`);
    try {
          const quote = await getQuote(SOL_MINT, tokenMint, amountLamports);
          const sig = await executeSwap(quote, keypair);
          heldToken = tokenMint; // blocca il bot su questa posizione
      console.log(`  -> Fatto! Tx: https://solscan.io/tx/${sig}`);
    } catch (err) {
          console.error('  -> Errore durante il buy:', err.message);
    }
}

async function copySell(tokenMint, fromWallet) {
    if (!config.copySell) {
          console.log('  -> Copy sell disattivato, ignoro la vendita');
          return;
    }
    if (heldToken !== tokenMint) {
          // Non e' il token che il bot possiede (o non possiede nulla): niente da fare
      return;
    }
    try {
          const tokenAccounts = await connection.getParsedTokenAccountsByOwner(keypair.publicKey, {
                  mint: new PublicKey(tokenMint),
          });
          if (tokenAccounts.value.length === 0) {
                  console.log('  -> Non possiedo questo token, niente da vendere');
                  heldToken = null;
                  return;
          }
          const amount = tokenAccounts.value[0].account.data.parsed.info.tokenAmount;
          const rawAmount = amount.amount;
          if (rawAmount === '0') {
                  console.log('  -> Saldo del token e\' zero, niente da vendere');
                  heldToken = null;
                  return;
          }

      console.log(`  -> COPIO SELL (da ${fromWallet}): tutto il saldo di ${tokenMint}`);
          const quote = await getQuote(tokenMint, SOL_MINT, rawAmount);
          const sig = await executeSwap(quote, keypair);
          heldToken = null; // posizione chiusa, il bot torna libero di seguire chiunque
      console.log(`  -> Fatto! Tx: https://solscan.io/tx/${sig}`);
    } catch (err) {
          console.error('  -> Errore durante il sell:', err.message);
    }
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
                console.log('  -> Non e\' uno swap riconosciuto, ignoro');
                continue;
        }
        if (swap.type === 'BUY') {
                console.log(`  -> Ha COMPRATO ${swap.tokenMint}`);
                await copyBuy(swap.tokenMint, target.address);
        } else if (swap.type === 'SELL') {
                console.log(`  -> Ha VENDUTO ${swap.tokenMint}`);
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
