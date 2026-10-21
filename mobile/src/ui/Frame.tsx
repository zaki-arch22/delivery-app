import React, { createContext, useContext, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { color } from '../lib/theme';

// Height of the area under the band (0 = not measured yet). Bottom panels use it to open up to the top of the screen.
const AreaHeight = createContext(0);
export const useAreaHeight = () => useContext(AreaHeight);

// The grey band at the top behind the phone's clock and battery, like the reference screenshots. The owner asked for it
// a little shorter than the status bar (Oct 2026): 70% of its height (the icons stay readable on the dark screens below).
// Every screen starts BELOW it: the screens are told the top inset is already taken (0), so no screen adds the space twice.
export function AppFrame({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [h, setH] = useState(0);
  const band = insets.top ? Math.max(20, Math.round(insets.top * 0.7)) : 0;
  return (
    <View style={{ flex: 1, backgroundColor: color.page }}>
      <View testID="status-bar-area" style={{ height: band, backgroundColor: color.statusBar }} />
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
        <AreaHeight.Provider value={h}>
          <View style={{ flex: 1 }} onLayout={e => setH(e.nativeEvent.layout.height)}>{children}</View>
        </AreaHeight.Provider>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}
