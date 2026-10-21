import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { base64Bytes } from './base64';

export type PickResult = { uri: string } | 'denied' | null;   // null = the person closed the camera/gallery

// Takes or chooses ONE photo, then shrinks it on the phone (at most 2000 px, JPEG) so it costs little mobile data.
// The server checks and redraws it again anyway. No location or camera data is requested.
export async function pickPhoto(source: 'camera' | 'library', front = false): Promise<PickResult> {
  const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return 'denied';
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false, allowsEditing: false, cameraType: front ? ImagePicker.CameraType.front : ImagePicker.CameraType.back };
  const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  const ctx = ImageManipulator.manipulate(a.uri);
  if (Math.max(a.width, a.height) > 2000) ctx.resize(a.width >= a.height ? { width: 2000 } : { height: 2000 });
  const out = await (await ctx.renderAsync()).saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  return { uri: out.uri };
}

export type PhotoBody = Blob | Uint8Array;
// The photo as bytes the server connection can send. The picture's own JPEG bytes are taken straight from the image tool
// (reading the file back through the phone's file handling lost the picture on some Android phones: "could not be read").
export async function photoBlob(uri: string): Promise<PhotoBody> {
  try {
    const out = await (await ImageManipulator.manipulate(uri).renderAsync()).saveAsync({ compress: 0.85, format: SaveFormat.JPEG, base64: true });
    if (out.base64 && out.base64.length > 100) return base64Bytes(out.base64);
  } catch { /* fall back to the file itself */ }
  return (await fetch(uri)).blob();
}
