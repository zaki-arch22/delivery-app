import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
// Only the three weights the app uses are bundled (the Cairo font covers Arabic and Latin; licence: SIL Open Font License).
import { Cairo_400Regular } from '@expo-google-fonts/cairo/400Regular';
import { Cairo_600SemiBold } from '@expo-google-fonts/cairo/600SemiBold';
import { Cairo_700Bold } from '@expo-google-fonts/cairo/700Bold';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../lib/app';
import { PushBridge } from '../lib/PushBridge';
import { color } from '../lib/theme';

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Cairo_400Regular, Cairo_600SemiBold, Cairo_700Bold });
  if (!fontsLoaded && !fontError) return null;   // the splash screen stays up while the font loads (bundled with the app)
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="light" />
        <PushBridge />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.page }, animation: 'fade' }} />
      </AppProvider>
    </SafeAreaProvider>
  );
}
