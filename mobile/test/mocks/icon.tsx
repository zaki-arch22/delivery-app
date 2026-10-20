// Test stand-in for the icon font (tests have no fonts): an icon is an empty view carrying its name.
import React from 'react';
import { View } from 'react-native';
export default function Feather({ name, testID }: any) { return <View testID={testID} accessibilityHint={'icon:' + name} />; }
