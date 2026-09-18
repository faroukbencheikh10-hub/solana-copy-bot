import { Keypair, Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import { mnemonicToSeedSync, validateMnemonic } from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { config } from './config.js';

// Carica il TUO wallet dalla chiave privata o dalla seed phrase (mai stampata nei log)
export function loadMyKeypair() {
  const raw = config.myPrivateKey.trim();

// Caso 1: array JSON tipo [12,34,...]
if (raw.startsWith('[')) {
  const secretKey = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secretKey);
}

// Caso 2: frase di recupero (seed phrase) a 12 o 24 parole
const words = raw.split(/\s+/);
  if (words.length === 12 || words.length === 24) {
    if (!validateMnemonic(raw)) {
      throw new Error('La seed phrase in MY_WALLET_PRIVATE_KEY non sembra valida');
    }
    const seed = mnemonicToSeedSync(raw);
    const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
    return Keypair.fromSeed(derivedSeed);
  }

// Caso 3: chiave privata in base58 (formato "Show Private Key" di Phantom)
const secretKey = bs58.decode(raw);
  return Keypair.fromSecretKey(secretKey);
}

export const connection = new Connection(config.rpcUrl, 'confirmed');
