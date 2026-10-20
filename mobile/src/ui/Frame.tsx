import React from 'react';
import { View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { color } from '../lib/theme';

// The grey band behind the phone's status bar (clock, battery), exactly as tall as that bar on each phone, like the
// reference screenshots. Every screen starts BELOW it: the screens are told the top inset is already taken (0), so no
// screen adds the space twice and nothing (map, panels, buttons) ever slides under the clock.
export function AppFrame({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: color.page }}>
      <View testID="status-bar-area" style={{ height: insets.top, backgroundColor: color.statusBar }} />
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
        <View style={{ flex: 1 }}>{children}</View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}
