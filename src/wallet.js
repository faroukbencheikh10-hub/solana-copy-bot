import { Keypair, Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { config } from './config.js';

// Un wallet Phantom puo' contenere PIU' conti, tutti nati dalla stessa frase di
// recupero ma con un "percorso di derivazione" diverso. Il primo conto usa
// m/44'/501'/0'/0', il secondo m/44'/501'/1'/0', e cosi' via. Alcuni wallet
// usano anche la forma corta, senza /0' finale.
//
// Se indichi MY_WALLET_ADDRESS, il bot prova tutti questi percorsi finche' non
// trova quello che corrisponde davvero all'indirizzo che gli hai indicato. Cosi'
// non serve indovinare quale conto sia quello giusto.
const MAX_ACCOUNTS_TO_SCAN = 20;

function derivationPaths(index) {
  return [`m/44'/501'/${index}'/0'`, `m/44'/501'/${index}'`];
}

function keypairFromSeed(seedHex, path) {
  const derived = derivePath(path, seedHex);
  return Keypair.fromSeed(derived.key);
}

function keypairFromMnemonic(mnemonic, expectedAddress) {
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error(
      "MY_WALLET_MNEMONIC non e' una frase di recupero valida (controlla di aver scritto tutte le parole correttamente, separate da uno spazio)"
    );
  }
  const seedHex = bip39.mnemonicToSeedSync(mnemonic).toString('hex');

  // Nessun indirizzo atteso: si usa il primo conto, come prima
  if (!expectedAddress) {
    return keypairFromSeed(seedHex, derivationPaths(0)[0]);
  }

  for (let index = 0; index < MAX_ACCOUNTS_TO_SCAN; index++) {
    for (const path of derivationPaths(index)) {
      const candidate = keypairFromSeed(seedHex, path);
      if (candidate.publicKey.toBase58() === expectedAddress) {
        console.log(`Conto trovato: e' il numero ${index + 1} del wallet (percorso ${path})`);
        return candidate;
      }
    }
  }

  throw new Error(
    `Non ho trovato l'indirizzo ${expectedAddress} tra i primi ${MAX_ACCOUNTS_TO_SCAN} conti di questa frase di recupero. ` +
      'Controlla che MY_WALLET_ADDRESS e MY_WALLET_MNEMONIC appartengano allo stesso wallet.'
  );
}

function keypairFromRawKey(rawKey) {
  let secretKey;
  if (rawKey.startsWith('[')) {
    secretKey = Uint8Array.from(JSON.parse(rawKey));
  } else {
    secretKey = bs58.decode(rawKey);
  }
  return Keypair.fromSecretKey(secretKey);
}

// Carica il TUO wallet. Ordine di preferenza:
// 1) Chiave privata grezza (MY_WALLET_PRIVATE_KEY), se disponibile: e' la piu' precisa
// 2) Frase di recupero (MY_WALLET_MNEMONIC), eventualmente insieme a
//    MY_WALLET_ADDRESS per individuare il conto giusto dentro il wallet
export function loadMyKeypair() {
  const mnemonic = (config.myMnemonic || '').trim();
  const rawKey = (config.myPrivateKey || '').trim();
  const expectedAddress = (config.myAddress || '').trim();

  let keypair;
  if (mnemonic) {
    keypair = keypairFromMnemonic(mnemonic, expectedAddress);
  } else if (rawKey) {
    keypair = keypairFromRawKey(rawKey);
  } else {
    throw new Error('Devi impostare MY_WALLET_PRIVATE_KEY oppure MY_WALLET_MNEMONIC nelle variabili di Railway');
  }

  // Controllo finale: se hai indicato un indirizzo atteso, deve corrispondere.
  // Meglio fermarsi subito che operare per sbaglio sul wallet sbagliato.
  if (expectedAddress && keypair.publicKey.toBase58() !== expectedAddress) {
    throw new Error(
      `La chiave impostata corrisponde all'indirizzo ${keypair.publicKey.toBase58()}, ` +
        `ma MY_WALLET_ADDRESS dice ${expectedAddress}. Controlla le variabili su Railway.`
    );
  }

  return keypair;
}

export const connection = new Connection(config.rpcUrl, 'confirmed');
