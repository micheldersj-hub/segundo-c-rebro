const FUSO = 'America/Sao_Paulo';
export const hojeSP = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(d);
export const somaDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00-03:00`); d.setUTCDate(d.getUTCDate() + n); return hojeSP(d);
};
export const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: FUSO });
export function quando(iso: string, agora = new Date()) {
  const d = new Date(iso);
  return hojeSP(d) === hojeSP(agora) ? hora(iso)
    : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: FUSO })} ${hora(iso)}`;
}
export function rotuloDia(dia: string, hoje = hojeSP()) {
  if (dia === hoje) return 'Hoje';
  if (dia === somaDias(hoje, 1)) return 'Amanhã';
  if (dia === somaDias(hoje, -1)) return 'Ontem';
  return new Date(`${dia}T12:00:00-03:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: FUSO });
}
export function saudacao(nome?: string | null, d = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: FUSO }).format(d));
  return `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}${nome ? `, ${nome.split(' ')[0]}` : ''}`;
}
