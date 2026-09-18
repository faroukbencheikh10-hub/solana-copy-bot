import { connection } from './wallet.js';
import { SOL_MINT } from './config.js';

// Analizza una transazione del wallet target e capisce se e' stato un BUY o un SELL
// Ritorna null se non e' uno swap riconoscibile (es. semplice trasferimento)
export async function classifySwap(signature, targetWallet) {
  const tx = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
  });
  if (!tx || tx.meta?.err) return null;

  const pre = tx.meta.preTokenBalances || [];
  const post = tx.meta.postTokenBalances || [];

  // Calcola variazione di ogni token per il wallet target
  const changes = new Map();
  for (const b of pre) {
    if (b.owner !== targetWallet) continue;
    changes.set(b.mint, -(parseFloat(b.uiTokenAmount.uiAmountString || '0')));
  }
  for (const b of post) {
    if (b.owner !== targetWallet) continue;
    const prev = changes.get(b.mint) || 0;
    changes.set(b.mint, prev + parseFloat(b.uiTokenAmount.uiAmountString || '0'));
  }

  // Variazione SOL nativo (approssimata dai lamports pre/post del wallet target)
  const accountKeys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
  const idx = accountKeys.indexOf(targetWallet);
  let solChange = 0;
  if (idx !== -1) {
    solChange = (tx.meta.postBalances[idx] - tx.meta.preBalances[idx]) / 1e9;
  }
  if (Math.abs(solChange) > 0.0001) {
    changes.set(SOL_MINT, (changes.get(SOL_MINT) || 0) + solChange);
  }

  // Trova cosa e' diminuito (venduto/speso) e cosa e' aumentato (comprato/ricevuto)
  let spent = null; // { mint, amount }
  let received = null;
  for (const [mint, delta] of changes.entries()) {
    if (delta < -0.000001 && (!spent || delta < spent.amount)) spent = { mint, amount: delta };
    if (delta > 0.000001 && (!received || delta > received.amount)) received = { mint, amount: delta };
  }

  if (!spent || !received) return null;

  if (spent.mint === SOL_MINT) {
    return { type: 'BUY', tokenMint: received.mint, solAmount: Math.abs(spent.amount) };
  }
  if (received.mint === SOL_MINT) {
    return { type: 'SELL', tokenMint: spent.mint, tokenAmount: Math.abs(spent.amount) };
  }
  // Swap token-to-token: lo trattiamo come BUY del token ricevuto (ignoriamo, troppo raro/rischioso)
  return null;
}
