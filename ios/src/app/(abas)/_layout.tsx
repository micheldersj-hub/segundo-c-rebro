// Abas nativas do iOS (Liquid Glass no iOS 26+). Cada aba tem sua própria pilha de telas.
import { NativeTabs } from 'expo-router/native-tabs';
import { DynamicColorIOS } from 'react-native';

export default function Abas() {
  const tint = DynamicColorIOS({ light: '#0B7468', dark: '#5EEAD4' });
  return (
    <NativeTabs tintColor={tint} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="hoje">
        <NativeTabs.Trigger.Label>Hoje</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'sun.max', selected: 'sun.max.fill' }} md="today" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tarefas">
        <NativeTabs.Trigger.Label>Tarefas</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'checklist', selected: 'checklist.checked' }} md="checklist" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="dimy" prominent>
        <NativeTabs.Trigger.Label>Dimy</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="waveform.circle.fill" md="mic" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="olho">
        <NativeTabs.Trigger.Label>Olho</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'eye', selected: 'eye.fill' }} md="visibility" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="mais">
        <NativeTabs.Trigger.Label>Mais</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="square.grid.2x2" md="apps" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
