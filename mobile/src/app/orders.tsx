import React, { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { useApp } from '../lib/app';
import { Order, orders } from '../lib/orders';
import { Button, Notice, Screen, T } from '../ui/kit';
import { OrderCard } from '../ui/OrderCard';

const PAGE = 20;   // the server's page size (list_orders)

// My orders (contract B: list_orders), newest first, 20 at a time.
export default function Orders() {
  const { t, services } = useApp();
  const [list, setList] = useState<Order[] | null>(null);
  const [page, setPage] = useState(1), [more, setMore] = useState(false), [busy, setBusy] = useState(false);
  const load = useCallback(async (p: number) => {
    setBusy(true);
    try { const r = await orders(services.client).list(p); setList(prev => (p === 1 ? r.orders : [...(prev ?? []), ...r.orders])); setMore(r.orders.length === PAGE); setPage(p); }
    catch { setList(prev => prev ?? []); } finally { setBusy(false); }
  }, [services]);
  useFocusEffect(useCallback(() => { load(1); }, [load]));
  return (
    <Screen testID="screen-orders">
      <Button kind="plain" label={'‹ ' + t('back')} onPress={() => router.back()} />
      <T kind="title">{t('my_orders')}</T>
      {list && !list.length ? <Notice testID="orders-empty" text={t('no_orders')} /> : null}
      {(list ?? []).map(o => <OrderCard key={o.id} o={o} onPress={() => router.push({ pathname: '/order/[id]', params: { id: o.id } })} />)}
      {more ? <Button testID="load-more" kind="secondary" busy={busy} label={t('load_more')} onPress={() => load(page + 1)} /> : null}
    </Screen>
  );
}
