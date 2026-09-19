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

  // --- Sniping di monete nuove (ALTO RISCHIO) ---
  // Oltre a copiare i wallet, il bot puo' cercare da solo monete Solana nate da
  // poco e comprarle in autonomia. Condivide lo stesso "un trade alla volta,
  // tutto il budget" usato per il copy trading: se il bot ha gia' una posizione
  // aperta (da copy o da snipe), ignora tutto finche' non la chiude.
  snipeEnabled: (process.env.SNIPE_ENABLED ?? 'true') === 'true',
  // Eta' massima della moneta (in minuti) perche' venga considerata "nuova"
  snipeMaxAgeMinutes: parseFloat(process.env.SNIPE_MAX_AGE_MINUTES ?? '60'),
  // Liquidita' minima del pool in USD (piu' bassa di MIN_LIQUIDITY_USD perche' le
  // monete appena nate hanno naturalmente meno liquidita', ma resta un filtro
  // di sicurezza anti-scam)
  snipeMinLiquidityUsd: parseFloat(process.env.SNIPE_MIN_LIQUIDITY_USD ?? '5000'),
  // Volume scambiato nell'ultima ora in USD, sotto il quale si scarta (segno di
  // moneta morta/senza interesse)
  snipeMinVolumeH1Usd: parseFloat(process.env.SNIPE_MIN_VOLUME_H1_USD ?? '3000'),
  // Vende in automatico quando il prezzo sale di questa percentuale (take profit)
  snipeTakeProfitPercent: parseFloat(process.env.SNIPE_TAKE_PROFIT_PERCENT ?? '50'),
  // Vende in automatico quando il prezzo scende di questa percentuale (stop loss)
  snipeStopLossPercent: parseFloat(process.env.SNIPE_STOP_LOSS_PERCENT ?? '30'),
  // Ogni quanti secondi cercare nuove monete e controllare il prezzo di quella
  // eventualmente comprata
  snipePollIntervalSeconds: parseInt(process.env.SNIPE_POLL_INTERVAL_SECONDS ?? '20', 10),
};

// Quanto SOL usare per ogni trade copiato da UN wallet, calcolato dal budget totale
export function tradeSizeSol() {
  return config.totalBudgetSol * (config.tradeSizePercent / 100);
}

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
