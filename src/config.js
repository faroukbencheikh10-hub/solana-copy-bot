import 'dotenv/config';

function required(name, fallback) {
    const v = process.env[name] ?? fallback;
    if (v === undefined || v === '') {
          throw new Error(`Manca la variabile d'ambiente ${name}. Controlla il tuo file .env`);
    }
    return v;
}

// TARGET_WALLETS: lista di indirizzi separati da virgola. TARGET_WALLET (singolare)
// resta supportato per compatibilita' con la configurazione precedente.
const rawTargets = process.env.TARGET_WALLETS ?? process.env.TARGET_WALLET ?? '';
const targetWallets = rawTargets
  .split(',')
  .map((w) => w.trim())
  .filter((w) => w.length > 0);

if (targetWallets.length === 0) {
    throw new Error("Manca TARGET_WALLETS (o TARGET_WALLET). Controlla il tuo file .env");
}

export const config = {
    rpcUrl: required('RPC_URL'),
    targetWallets,
    // Uno dei due e' obbligatorio, controllato in wallet.js (non qui, per permettere entrambi)
    myPrivateKey: process.env.MY_WALLET_PRIVATE_KEY ?? '',
    myMnemonic: process.env.MY_WALLET_MNEMONIC ?? '',
    totalBudgetSol: parseFloat(process.env.TOTAL_BUDGET_SOL ?? '0.5'),
    // Percentuale del saldo disponibile usata quando il bot compra. Con piu' wallet
    // seguiti insieme, il bot copia UN trade alla volta (il primo segnale che arriva,
    // da qualunque wallet della lista) e ci mette tutto il budget; mentre tiene una
    // posizione aperta, ignora nuovi acquisti degli altri wallet finche' non vende.
    tradeSizePercent: parseFloat(process.env.TRADE_SIZE_PERCENT ?? '100'),
    slippageBps: parseInt(process.env.SLIPPAGE_BPS ?? '150', 10),
    copySell: (process.env.COPY_SELL ?? 'true') === 'true',
    minLiquidityUsd: parseFloat(process.env.MIN_LIQUIDITY_USD ?? '20000'),
    pollIntervalSeconds: parseInt(process.env.POLL_INTERVAL_SECONDS ?? '5', 10),
};

// Quanto SOL usare per ogni trade copiato da UN wallet, calcolato dal budget totale
export function tradeSizeSol() {
    return config.totalBudgetSol * (config.tradeSizePercent / 100);
}

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
