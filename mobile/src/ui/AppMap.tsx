import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Camera, CameraRef, Map, Marker } from '@maplibre/maplibre-react-native';
import { mapStyleUrl } from '../lib/config';
import type { Point } from '../lib/location';
import { useApp } from '../lib/app';
import { color, font } from '../lib/theme';

export type Pin = { id: string; at: Point; label: string; kind: 'pickup' | 'dropoff' | 'driver' };
export type AppMapRef = { moveTo(p: Point): void };

// The one map of the app (MapLibre + free OpenStreetMap tiles). Pins carry a letter or an icon, never colour alone.
// With `centerPin`, a fixed pin sits in the middle and the person moves the map under it (`onMoved` gives the new centre).
export const AppMap = forwardRef<AppMapRef, { start: Point; zoom?: number; pins?: Pin[]; centerPin?: { label: string; kind: 'pickup' | 'dropoff' }; onMoved?: (p: Point) => void; testID?: string }>(
  function AppMap({ start, zoom = 15, pins = [], centerPin, onMoved, testID = 'map' }, ref) {
    const { t } = useApp();
    const cam = useRef<CameraRef>(null);
    useImperativeHandle(ref, () => ({ moveTo: p => cam.current?.easeTo({ center: [p.lng, p.lat], zoom: 16, duration: 600 }) }), []);
    return (
      <View style={s.wrap}>
        <Map testID={testID} style={StyleSheet.absoluteFill} mapStyle={mapStyleUrl()} logo={false} attribution compass={false}
          onRegionDidChange={e => { const c = e.nativeEvent.center; onMoved?.({ lng: c[0], lat: c[1] }); }}>
          <Camera ref={cam} initialViewState={{ center: [start.lng, start.lat], zoom }} />
          {pins.map(p => (
            <Marker key={p.id} id={p.id} lngLat={[p.at.lng, p.at.lat]} anchor={p.kind === 'driver' ? 'center' : 'bottom'}>
              <View style={[s.pin, p.kind === 'driver' ? s.pinDriver : p.kind === 'dropoff' ? s.pinB : s.pinA]} accessibilityLabel={p.label}><Text style={[s.pinText, p.kind === 'driver' && s.pinTextDriver]}>{p.kind === 'driver' ? '🛵' : p.kind === 'pickup' ? 'A' : 'B'}</Text></View>
            </Marker>
          ))}
        </Map>
        {centerPin ? (
          <View pointerEvents="none" style={s.centerWrap} accessibilityLabel={centerPin.label}>
            <View style={[s.pin, centerPin.kind === 'dropoff' ? s.pinB : s.pinA]}><Text style={s.pinText}>{centerPin.kind === 'pickup' ? 'A' : 'B'}</Text></View>
            <View style={s.stem} />
          </View>
        ) : null}
        <Text style={s.credit}>{t('map_credit')}</Text>
      </View>
    );
  });

const s = StyleSheet.create({
  wrap: { flex: 1, overflow: 'hidden', backgroundColor: color.soft },
  pin: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: color.white },
  pinA: { backgroundColor: color.primary },
  pinB: { backgroundColor: color.navy },
  pinDriver: { backgroundColor: color.white, borderColor: color.primary },
  pinText: { color: color.white, fontFamily: font.bold, fontSize: 16 },
  pinTextDriver: { fontSize: 18 },
  centerWrap: { position: 'absolute', left: '50%', top: '50%', marginLeft: -18, marginTop: -50, alignItems: 'center' },
  stem: { width: 4, height: 14, backgroundColor: color.text, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  credit: { position: 'absolute', bottom: 2, left: 6, fontSize: 10, color: color.text, backgroundColor: 'rgba(255,255,255,0.75)', paddingHorizontal: 4 },
});
