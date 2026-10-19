import React, { useCallback, useState } from 'react';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useApp, useNotices } from '../lib/app';
import { ACTIVE, Order, orders } from '../lib/orders';
import { Button, Gap, Notice, Screen, T } from '../ui/kit';
import { OrderCard } from '../ui/OrderCard';
import { DriverHome } from '../ui/DriverHome';

// Landing screen after login. Sender: send a parcel, parcels in progress, my orders. Driver: status (driver screens come next).
export default function Home() {
  const { t, state } = useApp();
  const p = state.active;
  if (!p) return <Redirect href="/" />;
  return p.type === 'user' ? <UserHome /> : <DriverHome />;
}

function UserHome() {
  const { t, state, services } = useApp();
  const [active, setActive] = useState<Order[]>([]);
  const load = useCallback(() => { orders(services.client).list(1).then(r => setActive(r.orders.filter(o => ACTIVE.includes(o.status)))).catch(() => {}); }, [services]);
  useFocusEffect(load);
  useNotices(n => { if (n.order_id) load(); });
  const p = state.active!;
  return (
    <Screen testID="screen-home">
      <T kind="title" testID="home-hello">{t('home_hello', { name: p.display_name })}</T>
      {state.notice?.code === 'NO_PROFILE_FOR_PATH' ? <Notice testID="notice-no-profile" text={t(state.notice.missing === 'driver' ? 'notice_no_profile_driver' : 'notice_no_profile_user')} /> : null}
      <Gap n={3} />
      <Button testID="send-parcel" label={t('home_send')} sub={t('home_send_sub')} onPress={() => router.push('/new-order')} />
      {active.length ? (<>
        <Gap n={3} />
        <T kind="label">{t('home_active')}</T>
        {active.map(o => <OrderCard key={o.id} o={o} onPress={() => router.push({ pathname: '/order/[id]', params: { id: o.id } })} />)}
      </>) : null}
      <Gap n={3} />
      <Button testID="open-orders" kind="secondary" label={t('my_orders')} onPress={() => router.push('/orders')} />
      <Button testID="open-settings" kind="plain" label={t('settings')} onPress={() => router.push('/settings')} />
    </Screen>
  );
}
