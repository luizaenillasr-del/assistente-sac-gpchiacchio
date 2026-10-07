// ============================================================
// IA.gs — Serviço de IA (OpenAI / Anthropic via UrlFetchApp)
// Equivalente a api/services/aiService.js
// ============================================================

function chamarOpenAI(prompt, opcoes) {
  opcoes = opcoes || {};
  var apiKey = OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY não configurada');
  var model = opcoes.model || AI_MODEL || 'gpt-4o-mini';
  var maxTokens = opcoes.maxTokens || 1024;
  var payload = {
    model: model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  var resp = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', options);
  if (resp.getResponseCode() >= 400) {
    throw new Error('OpenAI API ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 200));
  }
  var data = JSON.parse(resp.getContentText());
  return {
    texto: data.choices && data.choices[0] ? data.choices[0].message.content : '',
    modelo: data.model || model,
    tokensEntrada: data.usage ? data.usage.prompt_tokens : 0,
    tokensSaida: data.usage ? data.usage.completion_tokens : 0,
    provider: 'openai',
  };
}

function chamarAnthropic(prompt, opcoes) {
  opcoes = opcoes || {};
  var apiKey = ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada');
  var model = opcoes.model || 'claude-haiku-4-5';
  var maxTokens = opcoes.maxTokens || 1024;
  var payload = {
    model: model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  if (resp.getResponseCode() >= 400) {
    throw new Error('Anthropic API ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 200));
  }
  var data = JSON.parse(resp.getContentText());
  return {
    texto: data.content && data.content[0] ? data.content[0].text : '',
    modelo: data.model || model,
    tokensEntrada: data.usage ? data.usage.input_tokens : 0,
    tokensSaida: data.usage ? data.usage.output_tokens : 0,
    provider: 'anthropic',
  };
}

function chamarIA(prompt, opcoes) {
  var provider = (AI_PROVIDER || 'openai').toLowerCase();
  if (provider === 'anthropic') return chamarAnthropic(prompt, opcoes);
  return chamarOpenAI(prompt, opcoes);
}

// Analise semântica (equivalente a analisarManifestacao / motoreRegras + IA)
function analisarComIA(descricao, contextoExtra) {
  var prompt = [
    'Você é o assistente SAC do Grupo Chiacchio (fabricante de embalagens plásticas).',
    'Analise esta manifestação de cliente e retorne SOMENTE um JSON com os campos:',
    '{ "causa": "", "subcausa": "", "setor": "", "tipo": "", "prioridade": "Alta|Média|Baixa",',
    '  "resumo": "", "sentimento": "Positivo|Neutro|Negativo", "urgente": true|false }',
    '',
    'Manifestação: ' + descricao,
    contextoExtra ? 'Contexto adicional: ' + contextoExtra : '',
  ].join('\n');

  var resultado = chamarIA(prompt, { maxTokens: 512 });
  try {
    var json = resultado.texto.match(/\{[\s\S]*\}/);
    if (json) return JSON.parse(json[0]);
  } catch(e) {}
  return { causa: '', subcausa: '', setor: 'SAC', tipo: '', prioridade: 'Média', resumo: resultado.texto, sentimento: 'Neutro', urgente: false };
}

function gerarTratativaComIA(manifestacao, contexto) {
  var prompt = [
    'Você é especialista em SAC industrial (embalagens plásticas). Gere uma tratativa profissional em português para:',
    '',
    'Cliente: ' + (manifestacao.CLIENTE || manifestacao.NOME_CLIENTE || ''),
    'Empresa: ' + (manifestacao.EMPRESA_RECLAMADA || ''),
    'Setor: ' + (manifestacao.SETOR_DESTINADO || manifestacao.SETOR_SUGERIDO || ''),
    'Tipo: ' + (manifestacao.TIPO_RECLAMACAO || ''),
    'Descrição: ' + (manifestacao.DESCRICAO || manifestacao.RECLAMACAO || ''),
    contexto ? 'Histórico similar: ' + contexto : '',
    '',
    'Retorne APENAS o texto da tratativa, sem explicações adicionais.',
  ].join('\n');

  var resultado = chamarIA(prompt, { maxTokens: 800 });
  return { texto: resultado.texto, modelo: resultado.modelo, provider: resultado.provider };
}

function gerarDevolutivaComIA(manifestacao, tratativa) {
  var prompt = [
    'Você é especialista em SAC industrial. Gere uma devolutiva formal para o cliente sobre a resolução:',
    '',
    'Cliente: ' + (manifestacao.CLIENTE || ''),
    'Reclamação original: ' + (manifestacao.DESCRICAO || ''),
    'Tratativa aplicada: ' + (tratativa || ''),
    '',
    'Retorne APENAS o texto da devolutiva, em português formal, sem explicações adicionais.',
  ].join('\n');

  var resultado = chamarIA(prompt, { maxTokens: 600 });
  return { texto: resultado.texto, modelo: resultado.modelo };
}

function extrairSetorComIA(descricao) {
  var prompt = [
    'Dado o seguinte texto de uma reclamação de SAC industrial (embalagens plásticas),',
    'identifique o setor responsável. Responda SOMENTE com o nome do setor.',
    'Setores possíveis: Qualidade, Logística, Financeiro, Comercial, Produção, Faturamento / Expedição, SAC',
    '',
    'Texto: ' + descricao,
  ].join('\n');

  var resultado = chamarIA(prompt, { maxTokens: 50 });
  return { setor: resultado.texto.trim(), modelo: resultado.modelo };
}
