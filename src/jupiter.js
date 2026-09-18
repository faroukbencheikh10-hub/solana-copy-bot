import fetch from 'node-fetch';
import { VersionedTransaction } from '@solana/web3.js';
import { connection } from './wallet.js';
import { config } from './config.js';

const JUP_QUOTE_URL = 'https://lite-api.jup.ag/swap/v1/quote';
const JUP_SWAP_URL = 'https://lite-api.jup.ag/swap/v1/swap';

// Controlla la liquidità del token prima di comprare (protezione anti-scam/rug)
export async function checkLiquidity(mint) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await res.json();
    const pairs = data.pairs || [];
    if (pairs.length === 0) return 0;
    return Math.max(...pairs.map((p) => p.liquidity?.usd ?? 0));
  } catch (err) {
    console.error('Errore controllo liquidita:', err.message);
    return 0;
  }
}

// Ottiene un preventivo di scambio da Jupiter
export async function getQuote(inputMint, outputMint, amountLamports) {
  const url = `${JUP_QUOTE_URL}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${config.slippageBps}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Jupiter quote fallita: ${res.status}`);
  return res.json();
}

// Esegue lo scambio vero e proprio, firmando con il TUO wallet
export async function executeSwap(quoteResponse, keypair) {
  const res = await fetch(JUP_SWAP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  });
  if (!res.ok) throw new Error(`Jupiter swap fallito: ${res.status}`);
  const { swapTransaction } = await res.json();

  const txBuf = Buffer.from(swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([keypair]);

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await connection.confirmTransaction(signature, 'confirmed');
  return signature;
}
