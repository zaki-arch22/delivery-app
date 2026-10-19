import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import { useApp } from '../lib/app';
import { color } from '../lib/theme';
import { destination } from '../lib/nav';

// Decides where the app opens: a stored login goes straight in; otherwise the welcome screen.
// It navigates ONCE (and is replaced): later login changes are handled by the screens themselves, so no screen is stacked twice.
export default function Start() {
  const { ready, state } = useApp();
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    router.replace(destination(state));
  }, [ready, state]);
  return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: color.page }}><ActivityIndicator color={color.primary} size="large" /></View>;
}
