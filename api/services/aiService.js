'use strict';

// ============================================================
// AI SERVICE — Abstração de provider (F11)
// Suporta: anthropic | openai
// O Cérebro NÃO deve importar diretamente nenhum SDK.
// ============================================================

const LOG_IA = [];

function getProvider() {
  return (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
}

// ── Anthropic ────────────────────────────────────────────────
async function chamarAnthropic(prompt, opcoes = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada');

  const model = opcoes.model || process.env.AI_MODEL || 'claude-haiku-4-5';
  const maxTokens = opcoes.maxTokens || 1024;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout ? AbortSignal.timeout(opcoes.timeout || 20000) : undefined,
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    throw new Error(`Anthropic API ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  return {
    texto: data.content?.[0]?.text || '',
    modelo: data.model || model,
    tokensEntrada: data.usage?.input_tokens || 0,
    tokensSaida: data.usage?.output_tokens || 0,
    provider: 'anthropic',
  };
}

// ── OpenAI ────────────────────────────────────────────────────
async function chamarOpenAI(prompt, opcoes = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY não configurada');

  const model = opcoes.model || 'gpt-4o-mini';
  const maxTokens = opcoes.maxTokens || 1024;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout ? AbortSignal.timeout(opcoes.timeout || 20000) : undefined,
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    throw new Error(`OpenAI API ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  return {
    texto: data.choices?.[0]?.message?.content || '',
    modelo: data.model || model,
    tokensEntrada: data.usage?.prompt_tokens || 0,
    tokensSaida: data.usage?.completion_tokens || 0,
    provider: 'openai',
  };
}

// ── Interface pública ─────────────────────────────────────────

async function chamar(prompt, opcoes = {}) {
  const inicio = Date.now();
  const provider = getProvider();
  let resultado;

  try {
    if (provider === 'openai') {
      resultado = await chamarOpenAI(prompt, opcoes);
    } else {
      resultado = await chamarAnthropic(prompt, opcoes);
    }
    resultado.tempoMs = Date.now() - inicio;
    resultado.disponivel = true;
    _log(opcoes.contexto || 'geral', resultado, null);
    return resultado;
  } catch (e) {
    _log(opcoes.contexto || 'geral', null, e.message);
    return { disponivel: false, erro: e.message, provider, tempoMs: Date.now() - inicio };
  }
}

// Extrai JSON da resposta (robusto a texto extra)
function extrairJSON(texto) {
  if (!texto) return null;
  const match = texto.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function _log(contexto, resultado, erro) {
  LOG_IA.push({
    ts: new Date().toISOString(),
    contexto,
    provider: resultado?.provider || getProvider(),
    modelo: resultado?.modelo,
    tokensEntrada: resultado?.tokensEntrada,
    tokensSaida: resultado?.tokensSaida,
    tempoMs: resultado?.tempoMs,
    erro,
  });
  if (LOG_IA.length > 500) LOG_IA.shift();
}

function getUltimosLogs(n = 20) {
  return LOG_IA.slice(-n);
}

function isDisponivel() {
  const provider = getProvider();
  if (provider === 'openai') return !!process.env.OPENAI_API_KEY;
  return !!process.env.ANTHROPIC_API_KEY;
}

module.exports = { chamar, extrairJSON, isDisponivel, getUltimosLogs, getProvider };
