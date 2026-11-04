import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { View } from 'react-native';

import { useSessao } from '@/auth/sessao';
import { api } from '@/lib/api';
import { hora, quando, saudacao } from '@/lib/datas';
import type { Hoje } from '@/lib/tipos';
import { Carregando, Cartao, Falha, Tela, Texto, Vazio } from '@/ui/base';
import { Sincronia } from '@/ui/sincronia';
import { useCores } from '@/ui/tema';

export default function TelaHoje() {
  const c = useCores();
  const { eu } = useSessao();
  // GET /hoje é determinístico (banco + agenda): não gasta IA. Atualiza ao voltar ao app e ao puxar a tela.
  const q = useQuery({ queryKey: ['hoje'], queryFn: () => api<Hoje>('/hoje'), refetchInterval: 60_000 });
  const d = q.data;
  const agenda = Array.isArray(d?.agenda) ? d.agenda : [];
  return (
    <>
      <Stack.Screen options={{ title: saudacao(eu?.usuario.nome) }} />
      <Tela atualizando={q.isRefetching} aoAtualizar={() => void q.refetch()}>
        <Sincronia atualizadoEm={q.dataUpdatedAt || undefined} />
        {q.isPending ? <Carregando /> : q.isError && !d ? <Falha erro={q.error} aoTentar={() => void q.refetch()} /> : d ? (
          <>
            {d.perguntas.length ? (
              <Cartao style={{ borderLeftWidth: 4, borderLeftColor: c.azul }}>
                <Texto tipo="pequeno">O Dimy tem uma dúvida</Texto>
                {d.perguntas.map((p) => <Texto key={p.id}>{p.question}</Texto>)}
              </Cartao>
            ) : null}

            <Texto tipo="secao">Agenda</Texto>
            {d.agenda === null ? <Vazio texto="Conecte o Google Agenda em Mais › Integrações para ver seus compromissos." />
              : !Array.isArray(d.agenda) ? <Vazio texto="A agenda não respondeu agora. Puxe para atualizar." />
              : agenda.length ? agenda.map((e) => (
                <Cartao key={e.id}>
                  <View style={{ flexDirection: 'row', gap: 12, alignItems: 'baseline' }}>
                    <Texto style={{ fontWeight: '800', color: c.marForte }}>{hora(e.inicio)}</Texto>
                    <Texto style={{ flex: 1, fontWeight: '600' }}>{e.titulo}</Texto>
                  </View>
                  {e.local ? <Texto tipo="dica">{e.local}</Texto> : null}
                </Cartao>
              )) : <Vazio texto="Nenhum compromisso pelo resto do dia." />}

            <Texto tipo="secao">Lembretes</Texto>
            {d.lembretes.length ? d.lembretes.map((l) => (
              <Cartao key={l.id}><Texto>{l.text}</Texto><Texto tipo="pequeno">{quando(l.due_at)}</Texto></Cartao>
            )) : <Vazio texto="Sem lembretes. Peça ao Dimy: “me lembra de ligar para o Bruno às 15h”." />}

            {eu?.dono && d.aguardando.length ? (
              <>
                <Texto tipo="secao">Esperando sua resposta</Texto>
                {d.aguardando.slice(0, 8).map((p) => (
                  <Cartao key={p.wa_id}>
                    <Texto style={{ fontWeight: '600' }}>{p.name ?? `+${p.wa_id}`}</Texto>
                    {p.last_summary ? <Texto tipo="dica" numberOfLines={2}>{p.last_summary}</Texto> : null}
                  </Cartao>
                ))}
              </>
            ) : null}

            <Texto tipo="secao">Avisos recentes</Texto>
            {d.avisos.length ? d.avisos.slice(0, 6).map((a) => (
              <Cartao key={a.id} style={a.read_at ? undefined : { borderLeftWidth: 4, borderLeftColor: c.mar }}>
                <Texto style={{ fontWeight: '700' }}>{a.title}</Texto>
                <Texto tipo="dica" numberOfLines={3}>{a.body}</Texto>
                <Texto tipo="pequeno">{quando(a.created_at)}</Texto>
              </Cartao>
            )) : <Vazio texto="Aqui chegam o plano da manhã, o resumo da noite, lembretes e urgências." />}
          </>
        ) : null}
      </Tela>
    </>
  );
}
