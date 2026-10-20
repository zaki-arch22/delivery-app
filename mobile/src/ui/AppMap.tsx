import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Camera, CameraRef, GeoJSONSource, Layer, Map, Marker } from '@maplibre/maplibre-react-native';
import { mapStyleUrl } from '../lib/config';
import type { Point } from '../lib/location';
import { useApp } from '../lib/app';
import { color, font } from '../lib/theme';
import { Icon } from './Icon';

export type Pin = { id: string; at: Point; label: string; kind: 'pickup' | 'dropoff' | 'driver'; vehicle?: 'motorbike' | 'car' };
export type AppMapRef = { moveTo(p: Point, zoom?: number): void; fit(points: Point[]): void };
type Pad = { top: number; bottom: number; left: number; right: number };

// The one map of the app (MapLibre + free OpenStreetMap tiles from OpenFreeMap, dark style). Pins carry an icon and a
// spoken label, never colour alone. `route`: the road's shape from the server; without it (no routing server) a dashed
// straight line joins the two points, so nobody mistakes it for the road.
// With `centerPin`, a fixed pin sits in the middle and the person moves the map under it (`onMoved` gives the new centre).
export const AppMap = forwardRef<AppMapRef, {
  start: Point; zoom?: number; pins?: Pin[]; centerPin?: { label: string; kind: 'pickup' | 'dropoff' }; onMoved?: (p: Point) => void;
  route?: [number, number][] | null; fit?: Point[]; pad?: Partial<Pad>; testID?: string; onTouching?: (touching: boolean) => void;
}>(function AppMap({ start, zoom = 15, pins = [], centerPin, onMoved, route, fit, pad, testID = 'map', onTouching }, ref) {
  const { t } = useApp();
  const cam = useRef<CameraRef>(null);
  // While a finger is on the map, every icon on it disappears (only the centre pin, which marks the chosen point, stays);
  // they come back when the last finger is lifted. The screen hides its own buttons and cards too (onTouching).
  const [touching, setTouching] = useState(false);
  const isTouching = useRef(false);
  const touch = (on: boolean) => { if (isTouching.current === on) return; isTouching.current = on; setTouching(on); onTouching?.(on); };
  const padding: Pad = { top: 80, bottom: 80, left: 50, right: 50, ...pad };
  const fitNow = (pts: Point[]) => {
    if (pts.length === 0) return;
    if (pts.length === 1) { cam.current?.easeTo({ center: [pts[0].lng, pts[0].lat], zoom: 15, duration: 500 }); return; }
    const lngs = pts.map(p => p.lng), lats = pts.map(p => p.lat);
    cam.current?.fitBounds([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)], { padding, duration: 600 });
  };
  useImperativeHandle(ref, () => ({ moveTo: (p, z = 16) => cam.current?.easeTo({ center: [p.lng, p.lat], zoom: z, duration: 600 }), fit: fitNow }));
  const fitKey = (fit ?? []).map(p => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|');
  useEffect(() => { if (fit?.length) { const h = setTimeout(() => fitNow(fit), 250); return () => clearTimeout(h); } }, [fitKey, padding.bottom]);   // eslint-disable-line react-hooks/exhaustive-deps

  const a = pins.find(p => p.kind === 'pickup'), b = pins.find(p => p.kind === 'dropoff');
  const line = useMemo(() => {
    if (route && route.length >= 2) return { coords: route, dashed: false };
    if (a && b) return { coords: [[a.at.lng, a.at.lat], [b.at.lng, b.at.lat]] as [number, number][], dashed: true };
    return null;
  }, [route, a?.at.lat, a?.at.lng, b?.at.lat, b?.at.lng]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={s.wrap}>
      <View style={StyleSheet.absoluteFill} onTouchStart={() => touch(true)} onTouchEnd={e => { if (!e.nativeEvent.touches?.length) touch(false); }} onTouchCancel={() => touch(false)}>
      <Map testID={testID} style={StyleSheet.absoluteFill} mapStyle={mapStyleUrl()} logo={false} attribution compass={false}
        onRegionDidChange={e => { const c = e.nativeEvent.center; onMoved?.({ lng: c[0], lat: c[1] }); }}>
        <Camera ref={cam} initialViewState={{ center: [start.lng, start.lat], zoom }} />
        {line ? (
          <GeoJSONSource id="route" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line.coords } }}>
            <Layer id="route-casing" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': '#000000', 'line-width': 8, 'line-opacity': 0.35 }} />
            <Layer id="route-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={line.dashed ? { 'line-color': color.lime, 'line-width': 4, 'line-dasharray': [1.5, 1.5] } : { 'line-color': color.lime, 'line-width': 5 }} />
          </GeoJSONSource>
        ) : null}
        {touching ? null : pins.map(p => (
          <Marker key={p.id} id={p.id} lngLat={[p.at.lng, p.at.lat]} anchor={p.kind === 'driver' ? 'center' : 'bottom'}>
            <PinView kind={p.kind} label={p.label} vehicle={p.vehicle} />
          </Marker>
        ))}
      </Map>
      </View>
      {centerPin ? (
        <View pointerEvents="none" style={s.centerWrap} accessibilityLabel={centerPin.label} testID="center-pin">
          <PinView kind={centerPin.kind} label={centerPin.label} />
        </View>
      ) : null}
      {touching ? null : <Text style={s.credit}>{t('map_credit')}</Text>}
    </View>
  );
});

// A pickup pin (a box), a drop-off pin (a flag), or the courier (his vehicle), each with a short stem pointing at the spot.
export function PinView({ kind, label, vehicle }: { kind: 'pickup' | 'dropoff' | 'driver'; label: string; vehicle?: 'motorbike' | 'car' }) {
  if (kind === 'driver') return <View style={s.driver} accessibilityLabel={label}><Text style={s.driverText}>{vehicle === 'car' ? '🚗' : '🛵'}</Text></View>;
  return (
    <View style={s.pinWrap} accessibilityLabel={label}>
      <View style={[s.pin, kind === 'dropoff' && s.pinB]}><Icon name={kind === 'pickup' ? 'package' : 'flag'} size={20} tint={kind === 'pickup' ? color.ink : color.text} /></View>
      <View style={s.stem} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, overflow: 'hidden', backgroundColor: '#1B1C20' },
  pinWrap: { alignItems: 'center' },
  pin: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: color.lime, borderWidth: 2, borderColor: color.ink },
  pinB: { backgroundColor: color.ink, borderColor: color.pureWhite },
  stem: { width: 3, height: 12, backgroundColor: color.pureWhite, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  driver: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: color.pureWhite, borderWidth: 3, borderColor: color.lime },
  driverText: { fontSize: 20 },
  centerWrap: { position: 'absolute', left: '50%', top: '50%', marginLeft: -20, marginTop: -52, alignItems: 'center' },
  credit: { position: 'absolute', bottom: 2, right: 6, fontSize: 10, color: color.muted, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 4, fontFamily: font.regular },
});
