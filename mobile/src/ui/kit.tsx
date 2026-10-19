import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps, TextProps, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../lib/app';
import { color, font, minTouch, radius, space } from '../lib/theme';

// Text that follows the language direction (Arabic right-to-left).
export function T({ style, kind = 'body', ...p }: TextProps & { kind?: 'title' | 'body' | 'muted' | 'error' | 'label' }) {
  const { rtl } = useApp();
  return <Text {...p} style={[s.base, s[kind], { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' }, style]} />;
}

// One screen: safe area, page colour, scrolls when the keyboard is open, direction follows the language.
export function Screen({ children, testID }: { children: React.ReactNode; testID?: string }) {
  const { rtl } = useApp();
  return (
    <SafeAreaView style={s.safe} testID={testID}>
      <ScrollView contentContainerStyle={[s.screen, { direction: rtl ? 'rtl' : 'ltr' }]} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    </SafeAreaView>
  );
}

export function Button({ label, onPress, kind = 'primary', busy = false, disabled = false, testID, sub }:
  { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'plain' | 'danger'; busy?: boolean; disabled?: boolean; testID?: string; sub?: string }) {
  const off = disabled || busy;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: off, busy }}
      onPress={off ? undefined : onPress} style={({ pressed }) => [s.btn, s[`btn_${kind}`], off && s.btnOff, pressed && !off && s.btnPressed]}>
      {busy ? <ActivityIndicator color={kind === 'primary' ? color.white : color.primary} /> : (
        <View style={s.btnInner}>
          <Text style={[s.btnText, kind === 'primary' ? s.btnTextPrimary : kind === 'danger' ? s.btnTextDanger : s.btnTextOther]}>{label}</Text>
          {sub ? <Text style={[s.btnSub, kind === 'primary' ? s.btnTextPrimary : s.btnSubOther]}>{sub}</Text> : null}
        </View>
      )}
    </Pressable>
  );
}

export function Field({ label, error, hint, testID, ...p }: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  const { rtl } = useApp();
  return (
    <View style={s.field}>
      <T kind="label">{label}</T>
      <TextInput {...p} testID={testID} accessibilityLabel={label} placeholderTextColor={color.muted}
        style={[s.input, error ? s.inputError : null, { textAlign: rtl ? 'right' : 'left' }]} />
      {error ? <T kind="error" accessibilityLiveRegion="polite" testID={testID ? testID + '-error' : undefined}>⚠ {error}</T> : hint ? <T kind="muted">{hint}</T> : null}
    </View>
  );
}

// A calm information or warning box. Warnings use amber AND an icon (never colour alone).
export function Notice({ text, warn = false, testID }: { text: string; warn?: boolean; testID?: string }) {
  return <View testID={testID} style={[s.notice, warn && s.noticeWarn]}><T>{warn ? '⚠ ' : 'ℹ '}{text}</T></View>;
}

export const Gap = ({ n = 4 }: { n?: number }) => <View style={{ height: space(n) }} />;

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  screen: { padding: space(5), flexGrow: 1 },
  base: { color: color.text, fontFamily: font.regular, fontSize: 17, lineHeight: 26 },
  title: { fontFamily: font.bold, fontSize: 26, lineHeight: 38, color: color.navy },
  body: {},
  muted: { color: color.muted, fontSize: 15, lineHeight: 22 },
  error: { color: color.danger, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: font.semibold, fontSize: 15, marginBottom: space(1) },
  btn: { minHeight: minTouch, borderRadius: radius, paddingHorizontal: space(5), paddingVertical: space(3), justifyContent: 'center', marginVertical: space(1.5) },
  btn_primary: { backgroundColor: color.primary },
  btn_secondary: { backgroundColor: color.white, borderWidth: 2, borderColor: color.primary },
  btn_plain: { backgroundColor: 'transparent', minHeight: 44, alignSelf: 'flex-start', paddingHorizontal: 0 },
  btn_danger: { backgroundColor: color.white, borderWidth: 2, borderColor: color.danger },
  btnOff: { opacity: 0.5 },
  btnPressed: { opacity: 0.85 },
  btnInner: { alignItems: 'center' },
  btnText: { fontFamily: font.bold, fontSize: 18, lineHeight: 26, textAlign: 'center' },
  btnTextPrimary: { color: color.white },
  btnTextOther: { color: color.primary },
  btnTextDanger: { color: color.danger },
  btnSub: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  btnSubOther: { color: color.muted },
  field: { marginVertical: space(2) },
  input: { minHeight: minTouch, borderWidth: 2, borderColor: color.border, borderRadius: radius, backgroundColor: color.white, paddingHorizontal: space(4), fontSize: 20, fontFamily: font.semibold, color: color.text },
  inputError: { borderColor: color.danger },
  notice: { backgroundColor: color.soft, borderRadius: radius, padding: space(4), marginVertical: space(2) },
  noticeWarn: { backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: color.amber },
});
