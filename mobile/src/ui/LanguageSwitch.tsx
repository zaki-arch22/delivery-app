import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../lib/app';
import { LANGS, translate } from '../i18n';
import { color, font, radius, space } from '../lib/theme';

// Three buttons, each written in its own language, so anyone can find theirs.
export function LanguageSwitch() {
  const { lang, setLang, t } = useApp();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('choose_language')} style={s.row}>
      {LANGS.map(l => {
        const on = l === lang;
        return (
          <Pressable key={l} testID={'lang-' + l} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setLang(l)} style={[s.chip, on && s.on]}>
            <Text style={[s.text, on && s.textOn]}>{on ? '✓ ' : ''}{translate(l, 'lang_name')}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: space(2), flexWrap: 'wrap' },
  chip: { minHeight: 44, paddingHorizontal: space(4), borderRadius: radius, borderWidth: 2, borderColor: color.border, backgroundColor: color.white, justifyContent: 'center' },
  on: { borderColor: color.primary, backgroundColor: color.soft },
  text: { fontFamily: font.semibold, fontSize: 16, color: color.text },
  textOn: { color: color.primary },
});
