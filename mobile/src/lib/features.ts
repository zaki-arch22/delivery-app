import { useEffect, useState } from 'react';
import { useApp } from './app';
import { account } from './account';

// What the server switched on (asked once per app start). Today: place search.
let cached: Promise<{ place_search: boolean }> | null = null;
export function usePlaceSearch(): boolean {
  const { services } = useApp();
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    cached = cached ?? account(services.client).config().catch(() => { cached = null; return { place_search: false }; });
    cached.then(c => { if (live) setOn(!!c.place_search); });
    return () => { live = false; };
  }, [services]);
  return on;
}
export const resetFeatures = () => { cached = null; };   // tests
