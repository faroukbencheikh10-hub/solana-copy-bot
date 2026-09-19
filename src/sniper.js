import fetch from 'node-fetch';
import { config, SOL_MINT } from './config.js';

// Modulo "sniper": cerca monete Solana nate da poco (per default meno di 1 ora)
// e gia' scambiabili, cioe' con un pool di liquidita' vero.
//
// Usa GeckoTerminal, che ha un'API pubblica gratuita fatta apposta per elencare
// i pool appena creati ("new_pools"). A differenza dell'API non ufficiale di
// pump.fun, non blocca le richieste che arrivano dai server (Railway).
//
// NOTA IMPORTANTE: una moneta "nata 2 minuti fa" spesso NON e' ancora comprabile
// tramite Jupiter (lo strumento che il bot usa per scambiare), perche' vive
// ancora sulla bonding curve interna di pump.fun e non su un exchange vero
// (Raydium/Orca). Il bot quindi trova le monete piu' recenti tra quelle GIA'
// scambiabili, non letteralmente quelle nate da zero secondi.

const GECKO_NEW_POOLS = 'https://api.geckoterminal.com/api/v2/networks/solana/new_pools';

const triedMints = new Set(); // mint gia' provati, per non ricontrollarli in loop

export async function findFreshTokens() {
  try {
    const res = await fetch(`${GECKO_NEW_POOLS}?page=1`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      console.error(`[SNIPE] GeckoTerminal ha risposto ${res.status}`);
      return [];
    }
    const body = await res.json();
    const pools = Array.isArray(body?.data) ? body.data : [];

    const candidates = [];
    for (const pool of pools) {
      const info = evaluatePool(pool);
      if (info) candidates.push(info);
    }

    // Prima le piu' giovani
    candidates.sort((a, b) => a.ageMinutes - b.ageMinutes);
    return candidates;
  } catch (err) {
    console.error('[SNIPE] Errore ricerca monete nuove:', err.message);
    return [];
  }
}

function evaluatePool(pool) {
  try {
    const attr = pool?.attributes;
    if (!attr) return null;

    // L'id del token base arriva come "solana_<indirizzo>"
    const baseId = pool?.relationships?.base_token?.data?.id;
    if (!baseId) return null;
    const mint = baseId.replace(/^solana_/, '');
    if (!mint || mint === SOL_MINT) return null;
    if (triedMints.has(mint)) return null;

    const createdAt = attr.pool_created_at ? Date.parse(attr.pool_created_at) : NaN;
    if (Number.isNaN(createdAt)) return null;
    const ageMinutes = (Date.now() - createdAt) / 60000;

    const liquidityUsd = parseFloat(attr.reserve_in_usd ?? '0') || 0;
    const volumeH1Usd = parseFloat(attr.volume_usd?.h1 ?? '0') || 0;
    const priceUsd = parseFloat(attr.base_token_price_usd ?? '0') || 0;

    if (ageMinutes > config.snipeMaxAgeMinutes) return null;
    if (ageMinutes < 0) return null;
    if (liquidityUsd < config.snipeMinLiquidityUsd) return null;
    if (volumeH1Usd < config.snipeMinVolumeH1Usd) return null;
    if (!priceUsd) return null;

    const symbol = (attr.name ?? '?').split('/')[0].trim() || '?';

    return { mint, symbol, ageMinutes, liquidityUsd, volumeH1Usd, priceUsd };
  } catch (err) {
    return null;
  }
}

// Prezzo attuale del token, usato per decidere quando vendere (take profit / stop loss).
// Usa Dexscreener, la stessa fonte gia' usata per il controllo della liquidita'.
export async function getCurrentPriceUsd(mint) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    if (!res.ok) return null;
    const data = await res.json();
    const pairs = data.pairs || [];
    if (pairs.length === 0) return null;
    const best = pairs.reduce((a, b) => ((a.liquidity?.usd ?? 0) > (b.liquidity?.usd ?? 0) ? a : b));
    return parseFloat(best.priceUsd ?? '0') || null;
  } catch (err) {
    return null;
  }
}

export function markTried(mint) {
  triedMints.add(mint);
  // Evita che la lista cresca all'infinito
  if (triedMints.size > 500) {
    const first = triedMints.values().next().value;
    triedMints.delete(first);
  }
}
