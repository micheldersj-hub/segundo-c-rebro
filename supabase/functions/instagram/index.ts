// @ts-nocheck
// Gerado por esbuild a partir de supabase/functions/instagram/index.ts (código-fonte no repositório).
// _shared/config.ts
import { createClient } from "npm:@supabase/supabase-js@2";
var db = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } }
);
var cache = null;
var cachedAt = 0;
async function all() {
  if (cache && Date.now() - cachedAt < 6e4) return cache;
  const { data, error } = await db.rpc("get_app_secrets");
  if (error) throw new Error(`Falha ao ler segredos: ${error.message}`);
  const out = {};
  for (const [k, v] of Object.entries(data ?? {})) out[k.replace(/^sc_/, "")] = v;
  cache = out;
  cachedAt = Date.now();
  return out;
}
async function secret(name) {
  const v = Deno.env.get(name) ?? (await all())[name];
  if (!v) throw new Error(`Configuração ausente: ${name}`);
  return v;
}
async function optionalSecret(name, fallback) {
  return Deno.env.get(name) ?? (await all())[name] ?? fallback;
}
function text(body, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
function background(task, label) {
  const safe = task.catch((e) => console.error(`[${label}]`, e instanceof Error ? e.stack ?? e.message : e));
  const rt = globalThis.EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(safe);
}

// _shared/crypto.ts
var enc = new TextEncoder();
function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function hmac(secret2, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret2), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, enc.encode(data));
}
async function verifyMetaSignature(rawBody, header, appSecret) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = "sha256=" + toHex(await hmac(appSecret, rawBody));
  return safeEqual(header, expected);
}

// _shared/claude.ts
async function chatModel() {
  return await optionalSecret("CLAUDE_CHAT_MODEL", "claude-sonnet-5-5");
}
async function fastModel() {
  return await optionalSecret("CLAUDE_FAST_MODEL", "claude-haiku-4-5-20251001");
}
async function messages(body) {
  const key = await secret("ANTHROPIC_API_KEY");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if(res.ok){const __j=await res.json();__usoIA(__j);return __j}
    const detail = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    throw new Error(`Claude ${res.status}: ${detail.slice(0, 400)}`);
  }
}
async function structured(opts) {
  const res = await messages({
    model: opts.model === "chat" ? await chatModel() : await fastModel(),
    max_tokens: opts.maxTokens ?? 2e3,
    system: opts.system,
    tools: [opts.tool],
    tool_choice: { type: "tool", name: opts.tool.name },
    messages: [{ role: "user", content: opts.user }]
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error(`Claude não chamou ${opts.tool.name}`);
  return block.input;
}
function tool(name, properties, required, description) {
  return { name, description: description ?? `Responde com ${name}.`, input_schema: { type: "object", properties, required } };
}

// _shared/embeddings.ts
async function embed(texts) {
  if (texts.length === 0) return [];
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${await secret("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts.map((t) => t.slice(0, 8e3)), dimensions: 1024 })
  });
  if (!res.ok) throw new Error(`Embeddings ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
var toPgVector = (v) => `[${v.join(",")}]`;

// _shared/whatsapp.ts
async function graph(path, init = {}) {
  const version = await optionalSecret("WA_API_VERSION", "v21.0");
  return fetch(`https://graph.facebook.com/${version}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await secret("WA_ACCESS_TOKEN")}`, "Content-Type": "application/json", ...init.headers ?? {} }
  });
}
async function sendToOwner(text2) {
  const to = await secret("OWNER_WHATSAPP_NUMBER");
  const phoneId = await secret("WA_PHONE_NUMBER_ID");
  const template = await optionalSecret("WA_TEMPLATE_NAME");
  for (const part of splitText(text2, 3800)) {
    const res = await graph(`${phoneId}/messages`, {
      method: "POST",
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: part, preview_url: false } })
    });
    if (res.ok) continue;
    const err = await res.json().catch(() => ({}));
    if (err.error?.code === 131047 && template) {
      const tpl = await graph(`${phoneId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: template,
            language: { code: "pt_BR" },
            components: [{ type: "body", parameters: [{ type: "text", text: part.replace(/\s*\n\s*/g, " · ").slice(0, 1e3) }] }]
          }
        })
      });
      if (tpl.ok) continue;
      throw new Error(`Template falhou: ${await tpl.text()}`);
    }
    throw new Error(`WhatsApp ${res.status}: ${JSON.stringify(err).slice(0, 300)}`);
  }
}
function splitText(text2, max) {
  if (text2.length <= max) return [text2];
  const parts = [];
  let rest = text2;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

// _shared/memory.ts
var AREAS = ["trabalho", "familia", "saude", "estudo", "financas", "pessoal", "outro"];
var CATEGORIES = ["trabalho", "familia", "saude", "estudo", "financas", "habilidade", "dificuldade", "meta", "preferencia", "rotina", "outro"];
async function ingest(input) {
  const { data, error } = await db.from("raw_events").upsert(
    {
      source: input.source,
      external_id: input.externalId ?? null,
      content: input.content,
      is_audio: input.isAudio ?? false,
      metadata: input.metadata ?? {},
      occurred_at: (input.occurredAt ?? /* @__PURE__ */ new Date()).toISOString()
    },
    { onConflict: "source,external_id", ignoreDuplicates: true }
  ).select("id").maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}
var EXTRACTION_SYSTEM = `Você é o módulo de memória de um assistente pessoal ("segundo cérebro") do Michelder.
Transforme um registro bruto (mensagem, transcrição de áudio, e-mail ou evento de agenda) em memória estruturada.
Responda SEMPRE chamando a ferramenta "registrar_memoria".

Regras:
- summary: 1 frase, em português, na terceira pessoa ("Michelder ...").
- area: a área de vida predominante.
- people: nomes de pessoas citadas (sem o próprio Michelder).
- facts: apenas fatos DURÁVEIS, que continuarão verdadeiros por mais de 1 mês
  (quem é quem, habilidades, dificuldades recorrentes, metas, preferências, rotinas, projetos).
  Ignore o passageiro (o que almoçou hoje, um atraso pontual). E-mails promocionais ou automáticos não geram fatos.
- confidence: 0.9+ quando ele afirma diretamente; 0.5–0.7 quando é implícito; não invente.
- Se não houver fato durável, devolva facts vazio. É melhor faltar do que inventar.`;
var EXTRACTION_TOOL = tool("registrar_memoria", {
  summary: { type: "string" },
  area: { type: "string", enum: AREAS },
  mood: { type: "string", description: "Humor percebido em 1-2 palavras, se houver." },
  people: { type: "array", items: { type: "string" } },
  facts: {
    type: "array",
    items: {
      type: "object",
      properties: {
        statement: { type: "string" },
        category: { type: "string", enum: CATEGORIES },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        about: {
          type: "object",
          properties: { type: { type: "string", enum: ["pessoa", "empresa", "projeto", "lugar", "outro"] }, name: { type: "string" } },
          required: ["type", "name"]
        }
      },
      required: ["statement", "category", "confidence"]
    }
  }
}, ["summary", "area", "people", "facts"], "Registra o episódio e os fatos duráveis extraídos do registro.");
async function extract(content, source, occurredAt) {
  const raw = await structured({
    system: EXTRACTION_SYSTEM,
    user: `Fonte: ${source}
Data: ${occurredAt.toISOString()}

Registro:
"""
${content}
"""`,
    tool: EXTRACTION_TOOL,
    maxTokens: 1500
  });
  return {
    summary: String(raw.summary ?? "").trim() || "(sem resumo)",
    area: AREAS.includes(raw.area) ? raw.area : "outro",
    mood: raw.mood || void 0,
    people: Array.isArray(raw.people) ? raw.people.filter(Boolean) : [],
    facts: (Array.isArray(raw.facts) ? raw.facts : []).filter((f) => f && typeof f.statement === "string" && f.statement.trim() && CATEGORIES.includes(f.category)).map((f) => ({ ...f, confidence: Math.min(1, Math.max(0, Number(f.confidence) || 0.5)) }))
  };
}
async function processRawEvent(rawEventId) {
  const { data: ev, error } = await db.from("raw_events").select("id, source, content, occurred_at, processed, attempts").eq("id", rawEventId).single();
  if (error) throw error;
  if (ev.processed) return;
  await db.from("raw_events").update({ attempts: (ev.attempts ?? 0) + 1 }).eq("id", ev.id);
  try {
    const ext = await extract(ev.content, ev.source, new Date(ev.occurred_at));
    const [episodeVec, ...factVecs] = await embed([ext.summary, ...ext.facts.map((f) => f.statement)]);
    const { data: episode, error: epErr } = await db.from("episodes").insert({
      raw_event_id: ev.id,
      summary: ext.summary,
      area: ext.area,
      mood: ext.mood ?? null,
      people: ext.people,
      embedding: toPgVector(episodeVec),
      occurred_at: ev.occurred_at
    }).select("id").single();
    if (epErr) throw epErr;
    for (let i = 0; i < ext.facts.length; i++) {
      const f = ext.facts[i];
      const subjectId = f.about ? await upsertEntity(f.about.type, f.about.name) : null;
      await consolidate(f, factVecs[i], episode.id, subjectId);
    }
    await db.from("raw_events").update({ processed: true, processed_at: (/* @__PURE__ */ new Date()).toISOString(), error: null }).eq("id", ev.id);
    console.log(`evento ${ev.id}: episódio + ${ext.facts.length} fato(s)`);
  } catch (e) {
    await db.from("raw_events").update({ error: String(e).slice(0, 1e3) }).eq("id", ev.id);
    throw e;
  }
}
async function upsertEntity(type, name) {
  const { data, error } = await db.from("entities").upsert({ type, name: name.trim(), updated_at: (/* @__PURE__ */ new Date()).toISOString() }, { onConflict: "type,name" }).select("id").single();
  if (error) throw error;
  return data.id;
}
var SAME_FACT = 0.95;
var UNRELATED = 0.6;
var CONSOLIDATION_SYSTEM = `Você consolida a base de conhecimento pessoal do Michelder.
Compare um FATO NOVO com FATOS EXISTENTES parecidos e escolha UMA ação:
- NOVO: informação diferente, que convive com as existentes.
- DUPLICADO: diz o mesmo que um existente (só reforça). Informe target_fact_id.
- ATUALIZA: a situação mudou com o tempo e o novo substitui um existente
  (ex.: "trabalha na X" → "agora trabalha na Y"). Informe target_fact_id.
- CONFLITO: os dois não podem ser verdade ao mesmo tempo e não dá para saber qual vale.
  Informe target_fact_id e escreva uma pergunta curta e natural para o Michelder decidir.
Prefira ATUALIZA quando o texto indica mudança ("agora", "mudei", "não ... mais").`;
var CONSOLIDATION_TOOL = tool("decidir_consolidacao", {
  action: { type: "string", enum: ["NOVO", "DUPLICADO", "ATUALIZA", "CONFLITO"] },
  target_fact_id: { type: "string" },
  question: { type: "string" }
}, ["action"], "Decide como o fato novo entra na base.");
async function matchFacts(vec, count, minConfidence) {
  const { data, error } = await db.rpc("match_facts", { query_embedding: toPgVector(vec), match_count: count, min_confidence: minConfidence });
  if (error) throw error;
  return data ?? [];
}
async function consolidate(fact, vec, episodeId, subjectId) {
  const candidates = await matchFacts(vec, 5, 0);
  const top = candidates[0];
  let d;
  if (!top || top.similarity < UNRELATED) d = { action: "NOVO" };
  else if (top.similarity >= SAME_FACT) d = { action: "DUPLICADO", target_fact_id: top.id };
  else {
    const list = candidates.filter((c) => c.similarity >= UNRELATED).map((c) => `- id=${c.id} | [${c.category}] ${c.statement} (confiança ${c.confidence.toFixed(2)})`).join("\n");
    d = await structured({ system: CONSOLIDATION_SYSTEM, user: `FATO NOVO: [${fact.category}] ${fact.statement}

FATOS EXISTENTES:
${list}`, tool: CONSOLIDATION_TOOL, maxTokens: 500 });
  }
  const target = candidates.find((c) => c.id === d.target_fact_id);
  if (d.action !== "NOVO" && !target) d = { action: "NOVO" };
  switch (d.action) {
    case "DUPLICADO": {
      const { error } = await db.rpc("reinforce_fact", { fact_id: target.id, episode_id: episodeId });
      if (error) throw error;
      break;
    }
    case "ATUALIZA":
      await supersede(target.id, await insertFact(fact, vec, episodeId, subjectId));
      break;
    case "CONFLITO":
      await askQuestion(
        d.question ?? `Fiquei em dúvida: antes eu sabia que "${target.statement}", agora entendi que "${fact.statement}". Qual vale?`,
        { new_fact: fact, existing_fact_id: target.id, existing_statement: target.statement, episode_id: episodeId, subject_id: subjectId }
      );
      break;
    default:
      await insertFact(fact, vec, episodeId, subjectId);
  }
  return d.action;
}
async function insertFact(fact, vec, episodeId, subjectId, confidence) {
  const { data, error } = await db.from("facts").insert({
    statement: fact.statement,
    category: fact.category,
    confidence: confidence ?? fact.confidence,
    subject_entity_id: subjectId,
    source_episode_ids: episodeId ? [episodeId] : [],
    embedding: toPgVector(vec)
  }).select("id").single();
  if (error) throw error;
  return data.id;
}
async function supersede(oldId, newId) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const { error } = await db.from("facts").update({ status: "substituido", valid_to: now, superseded_by: newId, updated_at: now }).eq("id", oldId);
  if (error) throw error;
}
var MAX_OPEN_SENT = 2;
async function askQuestion(question, payload) {
  const { count } = await db.from("pending_questions").select("id", { count: "exact", head: true }).eq("status", "aberta").eq("payload->>sent", "true");
  const send = (count ?? 0) < MAX_OPEN_SENT;
  const { error } = await db.from("pending_questions").insert({ kind: "fact_conflict", question, payload: { ...payload, sent: send } });
  if (error) throw error;
  if (send) await sendToOwner(`🤔 ${question}`).catch((e) => console.warn("pergunta não enviada:", e));
}

// instagram/index.ts
Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === await secret("IG_VERIFY_TOKEN");
    return ok ? text(url.searchParams.get("hub.challenge") ?? "") : text("forbidden", 403);
  }
  if (req.method !== "POST") return text("method not allowed", 405);
  const raw = await req.text();
  if (!await verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), await secret("META_APP_SECRET"))) return text("invalid signature", 401);
  const body = JSON.parse(raw);
  if (body.object !== "instagram") return text("ignored");
  const store = async (content, externalId, occurredAt, metadata) => {
    const id = await ingest({ source: "instagram", content, externalId, occurredAt, metadata });
    if (id) await processRawEvent(id);
  };
  for (const entry of body.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      if (!m.message?.text || m.message.is_echo) continue;
      background(store(`DM no Instagram de um contato (id ${m.sender.id}): ${m.message.text}`, m.message.mid, new Date(m.timestamp), { kind: "dm", sender: m.sender.id }), "ig-dm");
    }
    for (const c of entry.changes ?? []) {
      if (c.field !== "comments" || !c.value.text || !c.value.id) continue;
      background(store(`Comentário no Instagram de @${c.value.from?.username ?? "desconhecido"}: ${c.value.text}`, c.value.id, new Date(entry.time * 1e3), { kind: "comment", media: c.value.media?.id }), "ig-comment");
    }
  }
  return text("ok");
});

// ---- consumo de IA (0032): grava tokens e buscas de cada chamada bem-sucedida em ia_consumo; nunca bloqueia nem quebra a chamada.
import { AsyncLocalStorage as __IA_ALS } from "node:async_hooks";
var __iaCtx = new __IA_ALS();
function __usoIA(j) {
  try {
    const u = j && j.usage; if (!u) return;
    const url = Deno.env.get("SUPABASE_URL"), k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (!url || !k) return;
    const st = u.server_tool_use || {};
    const p = fetch(url + "/rest/v1/ia_consumo", { method: "POST", headers: { apikey: k, Authorization: "Bearer " + k, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ funcao: "instagram", tarefa: (__iaCtx && __iaCtx.getStore()) || null, modelo: String(j.model || ""), entrada: u.input_tokens || 0, saida: u.output_tokens || 0,
        cache_escrita: u.cache_creation_input_tokens || 0, cache_leitura: u.cache_read_input_tokens || 0, buscas: st.web_search_requests || 0 }) }).catch(() => {});
    try { globalThis.EdgeRuntime?.waitUntil?.(p); } catch { /* sem waitUntil */ }
  } catch { /* nunca atrapalha */ }
}
