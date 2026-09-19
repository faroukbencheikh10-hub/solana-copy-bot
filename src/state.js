// Stato condiviso del bot: interruttore ON/OFF e posizione attualmente aperta.
// Serve a far comunicare il loop principale (index.js) con il server di
// controllo (controlServer.js) senza doverli far dipendere l'uno dall'altro.

let enabled = true; // se false, il bot NON apre nuove posizioni (ma puo' ancora chiuderle)
let heldToken = null; // mint del token attualmente posseduto, o null se libero
let heldFrom = null; // 'copy' oppure 'snipe'
let entryPriceUsd = null; // prezzo di ingresso, usato solo per le posizioni da 'snipe'
let lastAction = null; // ultima azione fatta dal bot, per la dashboard

export function isEnabled() {
  return enabled;
}

export function setEnabled(value) {
  enabled = Boolean(value);
}

export function getHeld() {
  return { heldToken, heldFrom, entryPriceUsd };
}

export function setHeld(token, from, price = null) {
  heldToken = token;
  heldFrom = from;
  entryPriceUsd = price;
}

export function clearHeld() {
  heldToken = null;
  heldFrom = null;
  entryPriceUsd = null;
}

export function setLastAction(action) {
  lastAction = { ...action, at: new Date().toISOString() };
}

export function getLastAction() {
  return lastAction;
}
