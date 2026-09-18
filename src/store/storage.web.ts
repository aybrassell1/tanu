/**
 * Web storage: the browser's localStorage for this site only. Nothing is sent
 * over the network.
 */

const KEY = 'masterfinance:ledger';
const PREVIOUS = 'masterfinance:ledger:previous';

export const storageDescription = 'Stored in this browser’s local storage on this device.';

/**
 * Asks the browser to keep this site's data. Without it, iOS and some desktop
 * browsers may evict local storage when space runs low or the app sits unused.
 * Granted silently on a home-screen app; harmless when refused.
 */
export async function requestDurableStorage(): Promise<boolean> {
  try {
    const storage = navigator.storage;
    if (!storage?.persist) return false;
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

export async function loadLedgerText(): Promise<string | null> {
  void requestDurableStorage();
  for (const key of [KEY, PREVIOUS]) {
    try {
      const text = window.localStorage.getItem(key);
      if (text) {
        JSON.parse(text);
        return text;
      }
    } catch {
      // Try the previous copy.
    }
  }
  return null;
}

export async function saveLedgerText(text: string): Promise<void> {
  try {
    const current = window.localStorage.getItem(KEY);
    if (current) window.localStorage.setItem(PREVIOUS, current);
    window.localStorage.setItem(KEY, text);
  } catch {
    // Out of space: drop the backup copy and try once more with just the data.
    window.localStorage.removeItem(PREVIOUS);
    try {
      window.localStorage.setItem(KEY, text);
    } catch {
      throw new Error('Browser storage is full. Export a backup and remove large receipts, or use the mobile app.');
    }
  }
}

export async function clearLedgerStorage(): Promise<void> {
  window.localStorage.removeItem(KEY);
  window.localStorage.removeItem(PREVIOUS);
}
