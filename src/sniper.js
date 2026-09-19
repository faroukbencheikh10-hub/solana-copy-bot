import fetch from 'node-fetch';
import { config } from './config.js';

// ============================================================
// SNIPER: cerca da solo monete Solana nate da poco (pump.fun) e
// fornisce a index.js le candidate da comprare (findFreshTokens),
// il prezzo attuale per gestire take profit/stop loss
// (getCurrentPriceUsd) e un modo per "segnare come provata" una
// moneta gia' tentata cosi' non viene riproposta ogni giro
// (markTried). La logica di comprare/vendere resta tutta in
// index.js, che tiene UNA sola posizione alla volta (copy o snipe).
// ============================================================

const PUMPFUN_NEW_COINS_URL =
      'https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false';

// Mint gia' provati (comprati con successo o falliti): non vengono riproposti
const triedMints = new Set();

export function markTried(mint) {
      triedMints.add(mint);
}

// Va a prendere le monete create da poco su pump.fun
async function fetchNewCoins() {
      try {
              const res = await fetch(PUMPFUN_NEW_COINS_URL);
              if (!res.ok) throw new Error(`pump.fun ha risposto ${res.status}`);
              return await res.json();
      } catch (err) {
              console.error('[Sniper] Errore nel recuperare le nuove monete da pump.fun:', err.message);
              return [];
      }
}

// Prende da Dexscreener il "pair" con piu' liquidita' per un dato mint:
// da li' ricaviamo prezzo, liquidita' e volume in un colpo solo.
async function getBestPair(mint) {
      try {
              const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
              if (!res.ok) return null;
              const data = await res.json();
              const pairs = data.pairs || [];
              if (pairs.length === 0) return null;
              return pairs.reduce((best, p) =>
                        (p.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? p : best
                                      );
      } catch (err) {
              console.error('[Sniper] Errore nel controllare Dexscreener:', err.message);
              return null;
      }
}

// Prezzo USD attuale di un token gia' comprato, usato da index.js per
// calcolare take profit / stop loss
export async function getCurrentPriceUsd(mint) {
      const pair = await getBestPair(mint);
      if (!pair?.priceUsd) return null;
      return parseFloat(pair.priceUsd);
}

// Trova monete nuove (nate da meno di config.snipeMaxAgeMinutes) che
// superano i filtri minimi di sicurezza (liquidita' e volume), e non
// sono gia' state provate. Ritorna un array di candidate pronte per essere
// comprate da index.js.
export async function findFreshTokens() {
      const coins = await fetchNewCoins();
      const candidates = [];

  for (const coin of coins) {
          const mint = coin?.mint;
          if (!mint) continue;
          if (triedMints.has(mint)) continue;

        const createdMs = (coin.created_timestamp ?? 0) * 1000;
          const ageMinutes = (Date.now() - createdMs) / 60000;
          if (ageMinutes < 0 || ageMinutes > config.snipeMaxAgeMinutes) continue;

        // Scarta monete gia' "completate" (migrate fuori da pump.fun) se il campo esiste
        if (coin.complete === true) continue;

        const pair = await getBestPair(mint);
          if (!pair) {
                    // Non ancora quotata su un DEX vero (o non ancora scambiabile su Jupiter):
            // niente da fare per ora, la ricontrolliamo al prossimo giro.
            continue;
          }

        const liquidityUsd = pair.liquidity?.usd ?? 0;
          const volumeH1Usd = pair.volume?.h1 ?? 0;
          const priceUsd = parseFloat(pair.priceUsd ?? '0');

        if (liquidityUsd < config.snipeMinLiquidityUsd) continue;
          if (volumeH1Usd < config.snipeMinVolumeH1Usd) continue;
          if (!priceUsd) continue;

        candidates.push({
                  mint,
                  symbol: coin.symbol || pair.baseToken?.symbol || '?',
                  ageMinutes,
                  liquidityUsd,
                  volumeH1Usd,
                  priceUsd,
        });
  }

  return candidates;
}
