import React from 'react';
import { Redirect } from 'expo-router';
import { useApp } from '../lib/app';
import { CustomerHome } from '../ui/CustomerHome';
import { DriverHome } from '../ui/DriverHome';

// Landing screen after login: the map of the current mode (Customer mode or Courier mode).
export default function Home() {
  const { state } = useApp();
  const p = state.active;
  if (!p) return <Redirect href="/" />;
  return p.type === 'user' ? <CustomerHome /> : <DriverHome />;
}
