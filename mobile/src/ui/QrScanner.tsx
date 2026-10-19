import React, { useEffect, useRef } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useApp } from '../lib/app';
import { color, space } from '../lib/theme';
import { Button, Notice, Screen, T } from './kit';

// Full-screen camera that reads ONE QR code, then closes. Typing the 4 digits always remains possible.
export function QrScanner({ visible, title, onCode, onClose }: { visible: boolean; title: string; onCode: (data: string) => void; onClose: () => void }) {
  const { t } = useApp();
  const [perm, ask] = useCameraPermissions();
  const done = useRef(false);
  useEffect(() => { if (visible) { done.current = false; if (perm && !perm.granted && perm.canAskAgain) ask(); } }, [visible, perm?.granted]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen testID="qr-scanner">
        <T kind="title">{title}</T>
        {perm?.granted ? (
          <View style={s.cam}>
            <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={r => { if (done.current) return; done.current = true; onCode(r.data); }} />
          </View>
        ) : <Notice warn text={t('camera_needed')} />}
        <Button kind="secondary" label={t('type_code_instead')} onPress={onClose} />
      </Screen>
    </Modal>
  );
}
const s = StyleSheet.create({ cam: { height: 320, borderRadius: 16, overflow: 'hidden', marginVertical: space(4), backgroundColor: color.navy } });
