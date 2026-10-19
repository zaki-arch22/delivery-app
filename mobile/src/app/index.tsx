import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useApp } from '../lib/app';
import { color } from '../lib/theme';
import { destination } from '../lib/nav';

// Decides where the app opens: a stored login goes straight in; otherwise the welcome screen.
export default function Start() {
  const { ready, state } = useApp();
  if (!ready) return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: color.page }}><ActivityIndicator color={color.primary} size="large" /></View>;
  return <Redirect href={destination(state)} />;
}
