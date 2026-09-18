import { Keypair, Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from './config.js';

// Carica il TUO wallet dalla chiave privata (mai stampata nei log)
export function loadMyKeypair() {
  const raw = config.myPrivateKey.trim();
  let secretKey;
  if (raw.startsWith('[')) {
    secretKey = Uint8Array.from(JSON.parse(raw));
  } else {
    secretKey = bs58.decode(raw);
  }
  return Keypair.fromSecretKey(secretKey);
}

export const connection = new Connection(config.rpcUrl, 'confirmed');
