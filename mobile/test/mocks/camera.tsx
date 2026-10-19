// Test stand-in for the phone camera: pressing "mock-scan" hands the scanner the QR text the test chose.
import React from 'react';
import { Pressable, Text } from 'react-native';
export const cameraMock = { next: '' };
export function CameraView({ onBarcodeScanned }: any) {
  return <Pressable testID="mock-scan" onPress={() => onBarcodeScanned?.({ data: cameraMock.next, type: 'qr' })}><Text>camera</Text></Pressable>;
}
export const useCameraPermissions = () => [{ granted: true, canAskAgain: true }, async () => ({ granted: true })];
