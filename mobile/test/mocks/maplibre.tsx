// Test stand-in for the native map (tests have no screen to draw on). It keeps the same props, so a test can
// "move the map" by firing onRegionDidChange, and it shows each pin as a plain view with the pin's label.
import React from 'react';
import { View } from 'react-native';
export const Map = ({ children, testID, onRegionDidChange }: any) => <View testID={testID} {...{ onRegionDidChange }}>{children}</View>;
export const Camera = React.forwardRef((_p: any, ref: any) => { React.useImperativeHandle(ref, () => ({ easeTo: () => {}, flyTo: () => {}, jumpTo: () => {}, fitBounds: () => {}, zoomTo: () => {} })); return null; });
export const Marker = ({ id, children }: any) => <View testID={'marker-' + id}>{children}</View>;
