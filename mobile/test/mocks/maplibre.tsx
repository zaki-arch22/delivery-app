// Test stand-in for the native map (tests have no screen to draw on). It keeps the same props, so a test can
// "move the map" by firing onRegionDidChange, and it shows each pin as a plain view with the pin's label.
import React from 'react';
import { View } from 'react-native';
export const Map = ({ children, testID, onRegionDidChange, onRegionWillChange, dragPan }: any) => <View testID={testID} accessibilityHint={dragPan === false ? 'locked' : undefined} {...{ onRegionDidChange, onRegionWillChange }}>{children}</View>;
// Camera commands are recorded (global.cameraCalls) so a test can check where the map was told to look.
export const Camera = React.forwardRef((_p: any, ref: any) => { const rec = (fn: string) => (o: any) => { ((globalThis as any).cameraCalls ??= []).push({ fn, ...o }); }; React.useImperativeHandle(ref, () => ({ easeTo: rec('easeTo'), flyTo: rec('flyTo'), jumpTo: rec('jumpTo'), fitBounds: () => {}, zoomTo: () => {} })); return null; });
export const Marker = ({ id, children }: any) => <View testID={'marker-' + id}>{children}</View>;
export const GeoJSONSource = ({ id, data, children }: any) => <View testID={'source-' + id} accessibilityHint={JSON.stringify(data?.geometry?.coordinates ?? null)}>{children}</View>;
export const Layer = ({ id, paint }: any) => <View testID={'layer-' + id} accessibilityHint={paint?.['line-dasharray'] ? 'dashed' : 'solid'} />;
