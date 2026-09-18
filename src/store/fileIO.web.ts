import * as DocumentPicker from 'expo-document-picker';

export async function exportTextFile(name: string, text: string, mimeType: string) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function pickTextFile(): Promise<{ name: string; text: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', 'text/csv', 'text/comma-separated-values', '.csv'] });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const text = asset.file ? await asset.file.text() : await (await fetch(asset.uri)).text();
  return { name: asset.name, text };
}

/** Receipts on web are data URLs; convert to a blob so the browser can open them. */
export async function openAttachment(uri: string) {
  const blob = await (await fetch(uri)).blob();
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) {
    const a = document.createElement('a');
    a.href = url;
    a.download = 'receipt';
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Browsers can't keep files privately, so receipts are embedded (size-limited). */
const MAX_BYTES = 400_000;

export async function pickAttachment(): Promise<{ uri: string; name: string; mimeType?: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'] });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (asset.size && asset.size > MAX_BYTES) {
    throw new Error('Receipts are limited to 400 KB in the web version. Use the mobile app for larger files.');
  }
  const blob = asset.file ?? (await (await fetch(asset.uri)).blob());
  const uri = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { uri, name: asset.name, mimeType: asset.mimeType };
}
