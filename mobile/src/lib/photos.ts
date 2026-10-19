import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export type PickResult = { uri: string } | 'denied' | null;   // null = the person closed the camera/gallery

// Takes or chooses ONE photo, then shrinks it on the phone (at most 2000 px, JPEG) so it costs little mobile data.
// The server checks and redraws it again anyway. No location or camera data is requested.
export async function pickPhoto(source: 'camera' | 'library'): Promise<PickResult> {
  const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return 'denied';
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false, allowsEditing: false };
  const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  const ctx = ImageManipulator.manipulate(a.uri);
  if (Math.max(a.width, a.height) > 2000) ctx.resize(a.width >= a.height ? { width: 2000 } : { height: 2000 });
  const out = await (await ctx.renderAsync()).saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  return { uri: out.uri };
}

// The photo file as data the server connection can send.
export async function photoBlob(uri: string): Promise<Blob> { return (await fetch(uri)).blob(); }
