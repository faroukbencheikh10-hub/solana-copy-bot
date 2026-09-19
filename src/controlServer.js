// Piccolo server HTTP di controllo per il bot.
// Espone due endpoint protetti da una chiave segreta (CONTROL_API_KEY):
//   GET  /api/status  -> stato attuale (acceso/spento, saldo, budget, posizione aperta...)
//   POST /api/toggle  -> accende/spegne il bot (body opzionale: { "enabled": true/false })
// Pensato per essere chiamato dalla dashboard su Vercel.

import http from 'node:http';
import { config } from './config.js';
import * as state from './state.js';

const API_KEY = process.env.CONTROL_API_KEY ?? '';
const PORT = process.env.PORT ?? 8080;

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function isAuthorized(req) {
  if (!API_KEY) return false; // senza chiave configurata, blocca tutto per sicurezza
  const key = req.headers['x-api-key'];
  return key === API_KEY;
}

export function startControlServer(getBalanceSolFn) {
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,x-api-key',
      });
      res.end();
      return;
    }

    // Endpoint pubblico minimale, utile per verificare che il servizio sia vivo
    // senza esporre dati sensibili (usato dal "health check" di Railway).
    if (req.url === '/' && req.method === 'GET') {
      return send(res, 200, { ok: true, service: 'solana-copy-bot' });
    }

    if (req.url === '/api/status' && req.method === 'GET') {
      if (!isAuthorized(req)) return send(res, 401, { error: 'unauthorized' });

      Promise.resolve(getBalanceSolFn())
        .catch(() => null)
        .then((balanceSol) => {
          const held = state.getHeld();
          send(res, 200, {
            enabled: state.isEnabled(),
            balanceSol,
            budgetSol: config.totalBudgetSol,
            tradeSizePercent: config.tradeSizePercent,
            targetWallets: config.targetWallets,
            snipeEnabled: config.snipeEnabled,
            held,
            lastAction: state.getLastAction(),
          });
        });
      return;
    }

    if (req.url === '/api/toggle' && req.method === 'POST') {
      if (!isAuthorized(req)) return send(res, 401, { error: 'unauthorized' });

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 10_000) req.destroy(); // protezione minima da payload assurdi
      });
      req.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const next = typeof parsed.enabled === 'boolean' ? parsed.enabled : !state.isEnabled();
          state.setEnabled(next);
          console.log(`[CONTROL] Bot ${next ? 'ATTIVATO' : 'MESSO IN PAUSA'} da remoto (dashboard)`);
          send(res, 200, { enabled: state.isEnabled() });
        } catch (err) {
          send(res, 400, { error: 'bad request' });
        }
      });
      return;
    }

    send(res, 404, { error: 'not found' });
  });

  server.listen(PORT, () => {
    console.log(`[CONTROL] Server di controllo in ascolto sulla porta ${PORT}`);
    if (!API_KEY) {
      console.warn('[CONTROL] ATTENZIONE: CONTROL_API_KEY non impostata, endpoint /api/* disabilitati');
    }
  });

  return server;
}
