import { File, Paths } from 'expo-file-system';

/**
 * Native storage: a single JSON file in the app's private document
 * directory. Writes go to a temp file first and are then moved into place, so
 * a crash mid-write can never leave a half-written ledger. The previous good
 * copy is kept as a fallback.
 */

const MAIN = 'ledger.json';
const TEMP = 'ledger.tmp.json';
const PREVIOUS = 'ledger.previous.json';

export const storageDescription = 'Stored in this app’s private folder on your device.';

export async function loadLedgerText(): Promise<string | null> {
  for (const name of [MAIN, PREVIOUS]) {
    try {
      const file = new File(Paths.document, name);
      if (file.exists) {
        const text = await file.text();
        if (text.trim()) {
          JSON.parse(text);
          return text;
        }
      }
    } catch {
      // Fall through to the backup copy.
    }
  }
  return null;
}

export async function saveLedgerText(text: string): Promise<void> {
  const temp = new File(Paths.document, TEMP);
  if (temp.exists) temp.delete();
  temp.create();
  temp.write(text);

  // Keep the last good copy, then atomically replace the main file. At no
  // point is the newest data only in the temp file.
  const main = new File(Paths.document, MAIN);
  if (main.exists) main.copySync(new File(Paths.document, PREVIOUS), { overwrite: true });
  temp.moveSync(main, { overwrite: true });
}

export async function clearLedgerStorage(): Promise<void> {
  for (const name of [MAIN, TEMP, PREVIOUS]) {
    const file = new File(Paths.document, name);
    if (file.exists) file.delete();
  }
}
