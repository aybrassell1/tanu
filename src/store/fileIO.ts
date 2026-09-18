import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Hands a generated file to the OS share sheet (save to Files, AirDrop, …). */
export async function exportTextFile(name: string, text: string, mimeType: string) {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name, UTI: mimeType === 'application/json' ? 'public.json' : 'public.comma-separated-values-text' });
}

/** Lets the user pick a file and returns its text, or null if cancelled. */
export async function pickTextFile(): Promise<{ name: string; text: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', 'text/csv', '*/*'], copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const text = await new File(asset.uri).text();
  return { name: asset.name, text };
}

/** Opens a stored receipt with the system viewer / share sheet. */
export async function openAttachment(uri: string, mimeType?: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Opening files is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType });
}

/** Copies a picked receipt into the app's private folder so it survives cache clears. */
export async function pickAttachment(): Promise<{ uri: string; name: string; mimeType?: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const source = new File(asset.uri);
  const dest = new File(Paths.document, `receipt-${Date.now()}-${asset.name.replace(/[^\w.-]/g, '_')}`);
  source.copySync(dest);
  return { uri: dest.uri, name: asset.name, mimeType: asset.mimeType };
}
