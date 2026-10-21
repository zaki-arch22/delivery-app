import { useEffect, useState } from 'react';
import { useApp } from './app';
import { account } from './account';
import type { SearchSettings } from './people';

// What the server switched on (asked once per app start): place search, and how the search circle grows.
type Features = { place_search: boolean; search?: SearchSettings };
let cached: Promise<Features> | null = null;
function useFeatures(): Features | null {
  const { services } = useApp();
  const [f, setF] = useState<Features | null>(null);
  useEffect(() => {
    let live = true;
    cached = cached ?? account(services.client).config().catch(() => { cached = null; return { place_search: false }; });
    cached.then(c => { if (live) setF(c); });
    return () => { live = false; };
  }, [services]);
  return f;
}
export const usePlaceSearch = (): boolean => !!useFeatures()?.place_search;
export const useSearchSettings = (): SearchSettings | null => useFeatures()?.search ?? null;
export const resetFeatures = () => { cached = null; };   // tests
