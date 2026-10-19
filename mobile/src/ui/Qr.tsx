import React, { useMemo } from 'react';
import { View } from 'react-native';
import QRCode from 'qrcode';

// A QR code drawn with plain views (no extra phone feature needed). Dark squares of a row are merged into one bar.
export function Qr({ value, size = 200, testID }: { value: string; size?: number; testID?: string }) {
  const rows = useMemo(() => {
    const m = QRCode.create(value, { errorCorrectionLevel: 'M' }).modules, n = m.size, out: { y: number; x: number; w: number }[][] = [];
    for (let y = 0; y < n; y++) {
      const row: { y: number; x: number; w: number }[] = [];
      for (let x = 0; x < n; x++) if (m.get(y, x)) { const last = row[row.length - 1]; if (last && last.x + last.w === x) last.w++; else row.push({ y, x, w: 1 }); }
      out.push(row);
    }
    return { n, out };
  }, [value]);
  const quiet = 2, cell = size / (rows.n + quiet * 2);
  return (
    <View testID={testID} accessibilityLabel="QR" style={{ width: size, height: size, backgroundColor: '#FFFFFF', alignSelf: 'center' }}>
      {rows.out.flat().map((r, i) => <View key={i} style={{ position: 'absolute', left: (r.x + quiet) * cell, top: (r.y + quiet) * cell, width: r.w * cell + 0.5, height: cell + 0.5, backgroundColor: '#0B1530' }} />)}
    </View>
  );
}
