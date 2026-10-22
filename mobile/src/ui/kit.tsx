import React from 'react';
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps, TextProps, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useApp } from '../lib/app';
import { color, font, minTouch, radius, space } from '../lib/theme';
import { Icon, IconName } from './Icon';

// Text that follows the language direction (Arabic right-to-left).
export function T({ style, kind = 'body', ...p }: TextProps & { kind?: 'title' | 'body' | 'muted' | 'error' | 'label' | 'big' }) {
  const { rtl } = useApp();
  return <Text {...p} style={[s.base, s[kind], { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' }, style]} />;
}

// One screen: safe area, dark page, scrolls when the keyboard is open, direction follows the language.
// With `title`, a header with a back arrow and the centred title (like every inner page).
export function Screen({ children, testID, title, onBack }: { children?: React.ReactNode; testID?: string; title?: string; onBack?: () => void }) {
  const { rtl } = useApp();
  const insets = useSafeAreaInsets();   // top is taken by the grey status band (AppFrame); bottom = the phone's gesture bar
  return (
    <View style={[s.safe, { paddingBottom: insets.bottom }]} testID={testID}>
      {title !== undefined ? <Header title={title} onBack={onBack} /> : null}
      <ScrollView contentContainerStyle={[s.screen, { direction: rtl ? 'rtl' : 'ltr' }]} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    </View>
  );
}

export function Header({ title, onBack }: { title: string; onBack?: () => void }) {
  const { t, rtl } = useApp();
  return (
    <View style={[s.header, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
      <Pressable testID="back" accessibilityRole="button" accessibilityLabel={t('back')} hitSlop={12} onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/home')))} style={s.headerBtn}>
        <Icon name="arrow-left" size={26} />
      </Pressable>
      <Text style={s.headerTitle} numberOfLines={1} accessibilityRole="header">{title}</Text>
      <View style={s.headerBtn} />
    </View>
  );
}

export function Button({ label, onPress, kind = 'primary', busy = false, disabled = false, testID, sub, a11y, icon, style }:
  { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'plain' | 'danger'; busy?: boolean; disabled?: boolean; testID?: string; sub?: string; a11y?: string; icon?: IconName; style?: ViewStyle }) {
  const off = disabled || busy;
  const fg = kind === 'primary' ? color.onBrand : kind === 'danger' ? color.danger : kind === 'plain' ? color.accent : color.text;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={a11y ?? label} accessibilityState={{ disabled: off, busy }}
      onPress={off ? undefined : onPress} style={({ pressed }) => [s.btn, s[`btn_${kind}`], off && s.btnOff, pressed && !off && s.btnPressed, style]}>
      {busy ? <ActivityIndicator color={fg} /> : (
        <View style={s.btnInner}>
          <View style={s.btnRow}>
            {icon ? <Icon name={icon} size={20} tint={fg} /> : null}
            <Text style={[s.btnText, { color: fg }]}>{label}</Text>
          </View>
          {sub ? <Text style={[s.btnSub, { color: kind === 'primary' ? color.onBrand : color.muted }]}>{sub}</Text> : null}
        </View>
      )}
    </Pressable>
  );
}

// A round button (menu, my location, minus/plus).
export function RoundButton({ icon, onPress, label, testID, size = 52, disabled = false, light = false }: { icon: IconName; onPress: () => void; label: string; testID?: string; size?: number; disabled?: boolean; light?: boolean }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [s.round, { width: size, height: size, borderRadius: size / 2 }, light && { backgroundColor: color.card2 }, disabled && s.btnOff, pressed && s.btnPressed]}>
      <Icon name={icon} size={Math.round(size * 0.45)} />
    </Pressable>
  );
}

export function Field({ label, error, hint, testID, ...p }: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  const { rtl } = useApp();
  return (
    <View style={s.field}>
      <View style={[s.fieldBox, error ? s.inputError : null]}>
        <Text style={[s.fieldLabel, { textAlign: rtl ? 'right' : 'left' }]}>{label}</Text>
        <TextInput {...p} testID={testID} accessibilityLabel={label} placeholderTextColor={color.muted}
          style={[s.input, { textAlign: rtl ? 'right' : 'left' }]} />
      </View>
      {error ? <T kind="error" accessibilityLiveRegion="polite" testID={testID ? testID + '-error' : undefined}>⚠ {error}</T> : hint ? <T kind="muted">{hint}</T> : null}
    </View>
  );
}

// A calm information or warning box. Warnings use amber AND an icon (never colour alone).
export function Notice({ text, warn = false, testID }: { text: string; warn?: boolean; testID?: string }) {
  const { rtl } = useApp();
  return (
    <View testID={testID} style={[s.notice, warn && s.noticeWarn, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
      <Icon name={warn ? 'alert-triangle' : 'info'} size={20} tint={warn ? color.amber : color.muted} />
      <T style={{ flex: 1 }}>{text}</T>
    </View>
  );
}

// A rounded dark card.
export const Card = ({ children, style, testID }: { children: React.ReactNode; style?: ViewStyle; testID?: string }) => <View testID={testID} style={[s.card, style]}>{children}</View>;

// One line of a list (menu, settings): icon, label, optional value, chevron.
export function Row({ icon, label, value, onPress, testID, danger = false }: { icon?: IconName; label: string; value?: string; onPress?: () => void; testID?: string; danger?: boolean }) {
  const { rtl } = useApp();
  return (
    <Pressable testID={testID} accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} style={({ pressed }) => [s.row, { flexDirection: rtl ? 'row-reverse' : 'row' }, pressed && onPress && { opacity: 0.7 }]}>
      {icon ? <Icon name={icon} size={22} tint={danger ? color.danger : color.muted} /> : null}
      <View style={{ flex: 1 }}>
        <T style={[s.rowLabel, danger && { color: color.danger }]}>{label}</T>
        {value ? <T kind="muted">{value}</T> : null}
      </View>
      {onPress ? <Icon name="chevron-right" size={20} tint={color.muted} /> : null}
    </Pressable>
  );
}

// Buttons and cards floating over a map: they fade away while a finger moves the map, and come back when it is lifted.
export function MapOverlay({ hidden, children, style }: { hidden: boolean; children: React.ReactNode; style?: ViewStyle | ViewStyle[] }) {
  const o = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => { Animated.timing(o, { toValue: hidden ? 0 : 1, duration: hidden ? 120 : 200, useNativeDriver: true }).start(); }, [hidden, o]);
  return <Animated.View pointerEvents={hidden ? 'none' : 'box-none'} style={[style as any, { opacity: o }]}>{children}</Animated.View>;
}

export const Gap = ({ n = 4 }: { n?: number }) => <View style={{ height: space(n) }} />;

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  screen: { padding: space(4), paddingBottom: space(10), flexGrow: 1 },
  header: { alignItems: 'center', paddingHorizontal: space(2), height: 56 },
  headerBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: color.text, fontFamily: font.bold, fontSize: 19 },
  base: { color: color.text, fontFamily: font.regular, fontSize: 17, lineHeight: 26 },
  title: { fontFamily: font.bold, fontSize: 26, lineHeight: 38 },
  big: { fontFamily: font.bold, fontSize: 32, lineHeight: 44 },
  body: {},
  muted: { color: color.muted, fontSize: 15, lineHeight: 22 },
  error: { color: color.danger, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: font.semibold, fontSize: 15, marginBottom: space(1) },
  btn: { minHeight: minTouch, borderRadius: radius, paddingHorizontal: space(5), paddingVertical: space(3), justifyContent: 'center', marginVertical: space(1.5) },
  btn_primary: { backgroundColor: color.brand },
  btn_secondary: { backgroundColor: color.card2 },
  btn_plain: { backgroundColor: 'transparent', minHeight: 44, alignSelf: 'flex-start', paddingHorizontal: 0 },
  btn_danger: { backgroundColor: color.card2 },
  btnOff: { opacity: 0.45 },
  btnPressed: { opacity: 0.8 },
  btnInner: { alignItems: 'center' },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  btnText: { fontFamily: font.bold, fontSize: 18, lineHeight: 26, textAlign: 'center' },
  btnSub: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  round: { backgroundColor: color.card, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  field: { marginVertical: space(1.5) },
  fieldBox: { backgroundColor: color.card2, borderRadius: radius, paddingHorizontal: space(4), paddingTop: space(2), minHeight: 64, borderWidth: 2, borderColor: 'transparent' },
  fieldLabel: { color: color.muted, fontFamily: font.regular, fontSize: 13 },
  input: { minHeight: 40, fontSize: 19, fontFamily: font.semibold, color: color.text, paddingVertical: 4 },
  inputError: { borderColor: color.danger },
  notice: { backgroundColor: color.card, borderRadius: radius, padding: space(4), marginVertical: space(2), gap: space(3), alignItems: 'flex-start' },
  noticeWarn: { backgroundColor: 'rgba(245,158,11,0.12)', borderWidth: 1, borderColor: color.amber },
  card: { backgroundColor: color.card, borderRadius: 20, padding: space(4), marginVertical: space(1.5) },
  row: { alignItems: 'center', gap: space(4), minHeight: 60, paddingVertical: space(2) },
  rowLabel: { fontFamily: font.semibold, fontSize: 18 },
});
