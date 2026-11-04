// Indicador de sincronização: online/offline e quando os dados foram atualizados.
import NetInfo from '@react-native-community/netinfo';
import { onlineManager, useIsFetching } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { hora } from '@/lib/datas';
import { Texto } from './base';
import { useCores } from './tema';

// TanStack Query pausa e retoma as requisições conforme a conexão do iPhone.
onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((s) => setOnline(!!s.isConnected && s.isInternetReachable !== false)));

export function Sincronia({ atualizadoEm }: { atualizadoEm?: number }) {
  const c = useCores();
  const buscando = useIsFetching();
  const [online, setOnline] = useState(onlineManager.isOnline());
  useEffect(() => onlineManager.subscribe(setOnline), []);
  const cor = !online ? c.ambar : buscando ? c.azul : c.verde;
  const texto = !online ? 'Sem conexão — mostrando o que está salvo' : buscando ? 'Sincronizando…' : atualizadoEm ? `Atualizado às ${hora(new Date(atualizadoEm).toISOString())}` : 'Sincronizado';
  return (
    <View accessibilityRole="text" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: cor }} />
      <Texto tipo="pequeno">{texto}</Texto>
    </View>
  );
}
