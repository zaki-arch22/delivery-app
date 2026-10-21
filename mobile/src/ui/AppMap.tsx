import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Camera, CameraRef, GeoJSONSource, Layer, Map, Marker } from '@maplibre/maplibre-react-native';
import { mapStyleUrl } from '../lib/config';
import type { Point } from '../lib/location';
import { useApp } from '../lib/app';
import { color, font } from '../lib/theme';
import { Icon } from './Icon';
import { Pulse } from './Pulse';

export type Pin = { id: string; at: Point; label: string; kind: 'pickup' | 'dropoff' | 'driver'; vehicle?: 'motorbike' | 'car' };
export type AppMapRef = { moveTo(p: Point, zoom?: number): void; fit(points: Point[]): void };
type Pad = { top: number; bottom: number; left: number; right: number };

// The one map of the app (MapLibre + free OpenStreetMap tiles from OpenFreeMap, light "liberty" style: clear like a street map). Pins carry an icon and a
// spoken label, never colour alone. `route`: the road's shape from the server; without it (no routing server) a dashed
// straight line joins the two points, so nobody mistakes it for the road.
// With `centerPin`, a fixed pin sits in the middle and the person moves the map under it (`onMoved` gives the new centre).
export const AppMap = forwardRef<AppMapRef, {
  start: Point; zoom?: number; pins?: Pin[]; centerPin?: { label: string; kind: 'pickup' | 'dropoff'; title?: string | null }; onMoved?: (p: Point) => void;
  route?: [number, number][] | null; fit?: Point[]; pad?: Partial<Pad>; testID?: string; onTouching?: (touching: boolean) => void;
  nearby?: { vehicle: 'motorbike' | 'car'; lat: number; lng: number }[]; pulse?: { at: Point; grow?: number } | null;
  follow?: { center: Point; from: number; to: number; ms: number } | null;
}>(function AppMap({ start, zoom = 15, pins = [], centerPin, onMoved, route, fit, pad, testID = 'map', onTouching, nearby = [], pulse, follow }, ref) {
  const { t } = useApp();
  const cam = useRef<CameraRef>(null);
  const mapRef = useRef<any>(null);
  // Where the "searching" pulse sits on screen: the point is projected to the screen and followed when the map moves.
  const { width: screenW } = useWindowDimensions();
  const [pulseXY, setPulseXY] = useState<{ x: number; y: number } | null>(null);
  const pulseKey = pulse ? `${pulse.at.lat},${pulse.at.lng}` : '';
  useEffect(() => {
    if (!pulse) { setPulseXY(null); return; }
    const place = async () => {
      try { const p = await mapRef.current?.project?.([pulse.at.lng, pulse.at.lat]); if (Array.isArray(p)) setPulseXY({ x: p[0], y: p[1] }); else if (!mapRef.current?.project) setPulseXY({ x: -1, y: -1 }); } catch { /* map not ready yet */ }
    };
    place(); const h = setInterval(place, 500); return () => clearInterval(h);
  }, [pulseKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const pulseR = Math.round(Math.min(screenW * 0.36, 150));
  // While a finger is on the map or the map is moving under it, every icon on it disappears (only the centre pin, which
  // marks the chosen point, stays); they come back when the map stops. The screen hides its own buttons and cards too
  // (onTouching). Two signals, because on phones the native map keeps the finger's moves to itself: a touch on the map
  // (a press without moving) and the map's own "starts moving because of the person / stopped moving" events.
  const [touching, setTouching] = useState(false);
  const finger = useRef(false), moving = useRef(false), shown = useRef(false);
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sync = () => {
    const on = finger.current || moving.current;
    if (safety.current) { clearTimeout(safety.current); safety.current = null; }
    if (on) safety.current = setTimeout(() => { finger.current = false; moving.current = false; sync(); }, 6000);   // never stay hidden by a lost event
    if (shown.current === on) return;
    shown.current = on; setTouching(on); onTouching?.(on);
  };
  const setFinger = (on: boolean) => { finger.current = on; sync(); };
  const setMoving = (on: boolean) => { moving.current = on; sync(); };
  useEffect(() => () => { if (safety.current) clearTimeout(safety.current); }, []);
  const padding: Pad = { top: 80, bottom: 80, left: 50, right: 50, ...pad };
  const fitNow = (pts: Point[]) => {
    if (pts.length === 0) return;
    if (pts.length === 1) { cam.current?.easeTo({ center: [pts[0].lng, pts[0].lat], zoom: 15, padding, duration: 500 }); return; }
    const lngs = pts.map(p => p.lng), lats = pts.map(p => p.lat);
    cam.current?.fitBounds([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)], { padding, duration: 600 });
  };
  useImperativeHandle(ref, () => ({ moveTo: (p, z = 16) => cam.current?.easeTo({ center: [p.lng, p.lat], zoom: z, duration: 600 }), fit: fitNow }));
  const fitKey = (fit ?? []).map(p => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|');
  useEffect(() => { if (fit?.length && !follow) { const h = setTimeout(() => fitNow(fit), 250); return () => clearTimeout(h); } }, [fitKey, padding.bottom, !follow]);
  // `follow`: the camera is driven by the screen (searching: centred on the pickup, zooming out by itself) and the person
  // cannot move the map by hand. ONE long, linear native animation from `from` to `to` over `ms` (smooth, no JS each
  // second), after a short glide to the starting zoom.
  const followKey = follow ? `${follow.center.lat},${follow.center.lng},${follow.from.toFixed(2)},${follow.to},${Math.round(follow.ms / 1000)}` : '';
  useEffect(() => {
    if (!follow) return;
    const center: [number, number] = [follow.center.lng, follow.center.lat];
    cam.current?.easeTo({ center, zoom: follow.from, padding, duration: 700, easing: 'ease' });
    if (follow.ms <= 0) return;
    const h = setTimeout(() => cam.current?.easeTo({ center, zoom: follow.to, padding, duration: follow.ms, easing: 'linear' }), 800);
    return () => clearTimeout(h);
  }, [followKey, padding.bottom]);   // eslint-disable-line react-hooks/exhaustive-deps   // eslint-disable-line react-hooks/exhaustive-deps

  const a = pins.find(p => p.kind === 'pickup'), b = pins.find(p => p.kind === 'dropoff');
  const line = useMemo(() => {
    if (route && route.length >= 2) return { coords: route, dashed: false };
    if (a && b) return { coords: [[a.at.lng, a.at.lat], [b.at.lng, b.at.lat]] as [number, number][], dashed: true };
    return null;
  }, [route, a?.at.lat, a?.at.lng, b?.at.lat, b?.at.lng]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={s.wrap}>
      <View style={StyleSheet.absoluteFill} onTouchStart={() => { if (!follow) setFinger(true); }} onTouchEnd={e => { if (!e.nativeEvent.touches?.length) setFinger(false); }} onTouchCancel={() => setFinger(false)}>
      <Map ref={mapRef} testID={testID} style={StyleSheet.absoluteFill} dragPan={!follow} touchZoom={!follow} doubleTapHoldZoom={!follow} touchRotate={!follow} touchPitch={!follow} mapStyle={mapStyleUrl()} logo={false} attribution compass={false}
        onRegionWillChange={e => { if (e.nativeEvent.userInteraction) setMoving(true); }}
        onRegionIsChanging={e => { if (e.nativeEvent.userInteraction && !moving.current) setMoving(true); }}
        onRegionDidChange={e => { finger.current = false; setMoving(false); const c = e.nativeEvent.center; onMoved?.({ lng: c[0], lat: c[1] }); }}
        onPress={() => setFinger(false)}>
        <Camera ref={cam} initialViewState={{ center: [start.lng, start.lat], zoom }} />
        {line ? (
          <GeoJSONSource id="route" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line.coords } }}>
            <Layer id="route-casing" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': '#000000', 'line-width': 8, 'line-opacity': 0.35 }} />
            <Layer id="route-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={line.dashed ? { 'line-color': color.lime, 'line-width': 4, 'line-dasharray': [1.5, 1.5] } : { 'line-color': color.lime, 'line-width': 5 }} />
          </GeoJSONSource>
        ) : null}
        {touching ? null : nearby.map((c, i) => (
          <Marker key={'n' + i} id={'nearby-' + i} lngLat={[c.lng, c.lat]} anchor="center">
            <View style={s.nearby} accessibilityLabel={t(c.vehicle === 'car' ? 'nearby_car' : 'nearby_moto')}><Text style={s.nearbyText}>{c.vehicle === 'car' ? '🚗' : '🛵'}</Text></View>
          </Marker>
        ))}
        {touching ? null : pins.map(p => (
          <Marker key={p.id} id={p.id} lngLat={[p.at.lng, p.at.lat]} anchor={p.kind === 'driver' ? 'center' : 'bottom'}>
            <PinView kind={p.kind} label={p.label} vehicle={p.vehicle} />
          </Marker>
        ))}
      </Map>
      </View>
      {centerPin ? (
        <View pointerEvents="none" style={s.centerWrap} accessibilityLabel={centerPin.label} testID="center-pin">
          {centerPin.title && !touching ? (
            <View style={s.bubble} testID="center-pin-title"><Text style={s.bubbleText} numberOfLines={1}>{centerPin.title}</Text></View>
          ) : null}
          <PinView kind={centerPin.kind} label={centerPin.label} />
        </View>
      ) : null}
      {pulse && pulseXY && !touching ? (
        <View pointerEvents="none" style={pulseXY.x < 0 ? s.pulseCentre : { position: 'absolute', left: pulseXY.x - pulseR, top: pulseXY.y - pulseR }}>
          <Pulse radius={pulseR} grow={pulse.grow} />
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
  nearby: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card, borderWidth: 1.5, borderColor: color.line },
  nearbyText: { fontSize: 16 },
  // The pin's stem tip sits exactly on the map's centre; the address bubble floats above it (like inDrive).
  centerWrap: { position: 'absolute', left: 0, right: 0, bottom: '50%', alignItems: 'center' },
  bubble: { maxWidth: '70%', backgroundColor: color.pureWhite, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 6,
    elevation: 6, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  bubbleText: { color: color.ink, fontFamily: font.semibold, fontSize: 15 },
  pulseCentre: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  credit: { position: 'absolute', bottom: 2, right: 6, fontSize: 10, color: color.muted, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 4, fontFamily: font.regular },
});
