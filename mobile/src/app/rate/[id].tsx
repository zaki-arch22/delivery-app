import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '../../lib/app';
import { errorMessage } from '../../lib/errors';
import { orders } from '../../lib/orders';
import { color, space } from '../../lib/theme';
import { Button, Field, Notice, Screen, T } from '../../ui/kit';

// Rate a delivered order: 1 to 5 stars and an optional comment that only staff read (contract B: submit_rating).
export default function Rate() {
  const { t, services } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [stars, setStars] = useState(0), [comment, setComment] = useState('');
  const [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  async function send() {
    if (stars < 1) { setMsg(t('choose_stars')); return; }
    setBusy(true); setMsg(null);
    try { await orders(services.client).rate(id, stars, comment.trim()); router.back(); }
    catch (e) { const m = errorMessage(e); setMsg(t(m.key, m.vars)); }
    finally { setBusy(false); }
  }
  return (
    <Screen testID="screen-rate">
      <Button kind="plain" label={'‹ ' + t('back')} onPress={() => router.back()} />
      <T kind="title">{t('rate_title')}</T>
      <View style={s.row} accessibilityRole="radiogroup">
        {[1, 2, 3, 4, 5].map(n => (
          <Pressable key={n} testID={'star-' + n} accessibilityRole="radio" accessibilityLabel={t('stars_label', { n })} accessibilityState={{ selected: stars === n }} onPress={() => { setStars(n); setMsg(null); }} hitSlop={6}>
            <Text style={[s.star, n <= stars && s.on]}>{n <= stars ? '★' : '☆'}</Text>
          </Pressable>
        ))}
      </View>
      {stars ? <T kind="muted">{t('stars_label', { n: stars })}</T> : null}
      <Field testID="comment" label={t('comment_label')} value={comment} onChangeText={setComment} maxLength={500} multiline />
      {msg ? <Notice warn text={msg} /> : null}
      <Button testID="send-rating" label={t('submit')} busy={busy} onPress={send} />
    </Screen>
  );
}
const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: space(2), marginVertical: space(4), justifyContent: 'center' },
  star: { fontSize: 44, color: color.border },
  on: { color: color.amber },
});
