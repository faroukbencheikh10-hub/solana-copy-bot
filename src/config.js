import 'dotenv/config';

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(`Manca la variabile d'ambiente ${name}. Controlla il tuo file .env`);
  }
  return v;
}

export const config = {
  rpcUrl: required('RPC_URL'),
  targetWallet: required('TARGET_WALLET'),
  myPrivateKey: required('MY_WALLET_PRIVATE_KEY'),
  totalBudgetSol: parseFloat(process.env.TOTAL_BUDGET_SOL ?? '0.5'),
  tradeSizePercent: parseFloat(process.env.TRADE_SIZE_PERCENT ?? '100'),
  slippageBps: parseInt(process.env.SLIPPAGE_BPS ?? '150', 10),
  copySell: (process.env.COPY_SELL ?? 'true') === 'true',
  minLiquidityUsd: parseFloat(process.env.MIN_LIQUIDITY_USD ?? '20000'),
  pollIntervalSeconds: parseInt(process.env.POLL_INTERVAL_SECONDS ?? '5', 10),
};

// Quanto SOL usare per ogni trade, calcolato dal budget totale
export function tradeSizeSol() {
  return config.totalBudgetSol * (config.tradeSizePercent / 100);
}

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
