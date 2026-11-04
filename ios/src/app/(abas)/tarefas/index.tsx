import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, TextInput, View } from 'react-native';

import { api } from '@/lib/api';
import { hojeSP, rotuloDia, somaDias } from '@/lib/datas';
import { erroAmigavel } from '@/lib/erros';
import { proximaEtapa, useAcoesTarefas } from '@/lib/tarefas';
import type { Etapa, ListaTarefas, Tarefa } from '@/lib/tipos';
import { Botao, Carregando, Cartao, Falha, Tela, Texto, Vazio } from '@/ui/base';
import { Sincronia } from '@/ui/sincronia';
import { useCores } from '@/ui/tema';

const NOMES: Record<Etapa, string> = { a_fazer: 'A fazer', fazendo: 'Fazendo', feito: 'Feito' };

export default function TelaTarefas() {
  const c = useCores();
  const [dia, setDia] = useState(hojeSP());
  const [nova, setNova] = useState('');
  const q = useQuery({ queryKey: ['tarefas', dia], queryFn: () => api<ListaTarefas>(`/tarefas?dia=${dia}`) });
  const { mover, criar, adiar } = useAcoesTarefas(dia);
  const cor: Record<Etapa, string> = { a_fazer: c.azul, fazendo: c.ambar, feito: c.verde };

  function tocar(t: Tarefa) {
    void Haptics.selectionAsync();
    mover.mutate({ id: t.id, etapa: proximaEtapa(t.etapa) }, { onError: (e) => Alert.alert('Não deu certo', erroAmigavel(e)) });
  }
  function menu(t: Tarefa) {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: t.titulo, options: ['A fazer', 'Fazendo', 'Feito', 'Passar para o próximo dia útil', 'Cancelar'], cancelButtonIndex: 4 },
      (i) => {
        const etapas: Etapa[] = ['a_fazer', 'fazendo', 'feito'];
        if (i < 3) mover.mutate({ id: t.id, etapa: etapas[i] });
        if (i === 3) adiar.mutate(t.id, { onError: (e) => Alert.alert('Não deu certo', erroAmigavel(e)) });
      });
  }
  async function adicionar() {
    const titulo = nova.trim(); if (!titulo) return;
    setNova('');
    criar.mutate(titulo, { onError: (e) => { setNova(titulo); Alert.alert('Não deu certo', erroAmigavel(e)); } });
  }

  const linha = (t: Tarefa) => (
    <Pressable key={t.id} onPress={() => tocar(t)} onLongPress={() => menu(t)} accessibilityRole="button"
      accessibilityLabel={`${t.titulo}, ${NOMES[t.etapa]}. Toque para avançar; segure para mais opções.`}>
      <Cartao style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: cor[t.etapa] }} />
        <View style={{ flex: 1, gap: 2 }}>
          <Texto style={{ fontWeight: '600', textDecorationLine: t.etapa === 'feito' ? 'line-through' : 'none', opacity: t.etapa === 'feito' ? 0.6 : 1 }}>{t.titulo}</Texto>
          <Texto tipo="pequeno">{[NOMES[t.etapa], t.projeto, t.prazo ? `prazo ${rotuloDia(t.prazo)}` : null, t.subtarefas ? `${t.subtarefas.feitas}/${t.subtarefas.total}` : null].filter(Boolean).join(' · ')}</Texto>
        </View>
      </Cartao>
    </Pressable>
  );

  const d = q.data;
  return (
    <>
      <Stack.Screen options={{ title: 'Tarefas' }} />
      <Tela atualizando={q.isRefetching} aoAtualizar={() => void q.refetch()}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Botao titulo="‹" tipo="claro" aoTocar={() => setDia(somaDias(dia, -1))} />
          <Texto style={{ fontWeight: '700', fontSize: 18 }}>{rotuloDia(dia)}</Texto>
          <Botao titulo="›" tipo="claro" aoTocar={() => setDia(somaDias(dia, 1))} />
        </View>
        <Sincronia atualizadoEm={q.dataUpdatedAt || undefined} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={nova} onChangeText={setNova} onSubmitEditing={adicionar} placeholder="Nova tarefa" placeholderTextColor={c.tintaFraca}
            returnKeyType="done" style={{ flex: 1, backgroundColor: c.superficie, color: c.tinta, borderRadius: 14, padding: 13, fontSize: 16 }} accessibilityLabel="Nova tarefa" />
          <Botao titulo="Criar" aoTocar={adicionar} desativado={!nova.trim()} />
        </View>
        {q.isPending ? <Carregando /> : q.isError && !d ? <Falha erro={q.error} aoTentar={() => void q.refetch()} /> : d ? (
          <>
            {d.atrasadas.length ? <><Texto tipo="secao" style={{ color: c.alerta }}>Atrasadas</Texto>{d.atrasadas.map(linha)}</> : null}
            {d.tarefas.length ? d.tarefas.map(linha) : <Vazio texto="Nada para este dia. Crie uma tarefa acima ou peça ao Dimy." />}
            {d.sugestoes_pendentes ? <Texto tipo="dica">{d.sugestoes_pendentes} sugestão(ões) do Dimy esperando você.</Texto> : null}
          </>
        ) : null}
      </Tela>
    </>
  );
}
