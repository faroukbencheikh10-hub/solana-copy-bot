# Solana Copy Trading Bot

Bot che copia in automatico i trade (acquisti e vendite) del wallet `tanlobster80525`
(indirizzo `6ePbEvTDFGPembAtY1vwLF4CWbTWKFisUE2G2k53tHHw`).

## ATTENZIONE - LEGGI PRIMA DI USARLO

Questo bot e' impostato per usare **TUTTO il saldo disponibile ad ogni singolo trade**
(configurazione richiesta: `TRADE_SIZE_PERCENT=100`). Significa che:

- Se il wallet copiato compra un token che poi va a zero (rug pull, token falso, bug),
  **perdi tutto il budget in un colpo solo**, non solo una parte.
- Non c'e' diversificazione: un solo trade sbagliato puo' azzerare il conto.
- Un bug nel bot (calcolo sbagliato, errore di rete, prezzo cambiato troppo in fretta)
  esegue comunque l'operazione con TUTTI i soldi, senza che tu possa fermarlo in tempo.
- Nessuna performance passata del wallet copiato garantisce risultati futuri.

Se preferisci un rischio piu' controllato, nel file `.env` puoi abbassare
`TRADE_SIZE_PERCENT` (es. a 10 o 20) cosi' ogni trade usa solo una parte del budget.

## Come funziona

1. Il bot controlla ogni pochi secondi (`POLL_INTERVAL_SECONDS`) le transazioni nuove
   del wallet target sulla blockchain Solana.
2. Quando rileva un acquisto (SOL -> Token), lo replica sul tuo wallet usando tutto
   il saldo SOL disponibile (meno un margine per le fee).
3. Quando rileva una vendita (Token -> SOL), se `COPY_SELL=true` vende tutto il saldo
   che hai di quel token.
4. Prima di ogni acquisto controlla la liquidita' del token su Dexscreener: se e'
   sotto `MIN_LIQUIDITY_USD` il trade viene SALTATO per evitare token-truffa.

## Configurazione (passo per passo)

1. Copia `.env.example` in `.env`:
   ```
   cp .env.example .env
   ```
2. Apri `.env` e compila:
   - `RPC_URL`: crea un account gratuito su https://www.helius.dev e prendi la tua
     API key, poi mettila nell'URL.
   - `MY_WALLET_PRIVATE_KEY`: la chiave privata del wallet che vuoi far operare al bot.
     In Phantom: Impostazioni -> Sicurezza e Privacy -> Esporta Chiave Privata.
     **NON condividere mai questa chiave con nessuno, non inviarla in chat, non
     salvarla su Google Drive/Notion/GitHub pubblico.**
   - `TOTAL_BUDGET_SOL`: quanti SOL ha il wallet dedicato a questo bot (circa 100 euro
     in SOL, controlla il cambio del giorno).
   - Il resto puoi lasciarlo com'e' per iniziare.

3. **IMPORTANTE**: usa un wallet SEPARATO, creato apposta per questo bot, con dentro
   SOLO i soldi che sei disposto a perdere. Mai la chiave del tuo wallet principale.

## Installazione ed esecuzione in locale (per testare)

```
npm install
npm start
```

## Metterlo online 24/7 su Railway

1. Crea un nuovo progetto su Railway (railway.app), collegato a questo repository.
2. Nelle variabili d'ambiente del servizio, inserisci le stesse chiavi di `.env`
   (mai scrivere la chiave privata nel codice o su GitHub).
3. Comando di avvio: `npm start`.
4. Railway terra' il bot acceso in automatico, riavviandolo se si blocca.

## Rischi che restano comunque

- Il copy trading replica con qualche secondo di ritardo: puoi comprare a un prezzo
  leggermente diverso da quello che ha pagato lui.
- Se il wallet copiato smette di essere profittevole, il bot continua a seguirlo
  comunque, in perdita, finche' non lo fermi tu.
- Nessun controllo umano prima di ogni operazione: il bot esegue da solo, 24/24.

Ti consiglio di iniziare con un importo piccolo per qualche giorno prima di
aumentare il budget.
