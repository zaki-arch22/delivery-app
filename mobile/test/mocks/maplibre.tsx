// Test stand-in for the native map (tests have no screen to draw on). It keeps the same props, so a test can
// "move the map" by firing onRegionDidChange, and it shows each pin as a plain view with the pin's label.
import React from 'react';
import { View } from 'react-native';
export const Map = ({ children, testID, onRegionDidChange, onRegionWillChange }: any) => <View testID={testID} {...{ onRegionDidChange, onRegionWillChange }}>{children}</View>;
export const Camera = React.forwardRef((_p: any, ref: any) => { React.useImperativeHandle(ref, () => ({ easeTo: () => {}, flyTo: () => {}, jumpTo: () => {}, fitBounds: () => {}, zoomTo: () => {} })); return null; });
export const Marker = ({ id, children }: any) => <View testID={'marker-' + id}>{children}</View>;
export const GeoJSONSource = ({ id, data, children }: any) => <View testID={'source-' + id} accessibilityHint={JSON.stringify(data?.geometry?.coordinates ?? null)}>{children}</View>;
export const Layer = ({ id, paint }: any) => <View testID={'layer-' + id} accessibilityHint={paint?.['line-dasharray'] ? 'dashed' : 'solid'} />;
