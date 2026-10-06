# PROMPT — Módulo Pesquisa de Satisfação + Relatórios · Assistente SAC

## Comando (cole no Claude Code)

> Quero incluir no Assistente SAC o módulo **Pesquisa de Satisfação** e o módulo **Relatórios de Satisfação**, **dentro da ferramenta**: mesmo login, mesmo menu lateral, mesmas permissões, mesma base de clientes, empresas, setores e manifestações. Hoje a pesquisa e o relatório mensal são feitos fora do sistema (formulário + planilha + apresentação). Eles precisam passar a ser criados, enviados, respondidos, tratados, analisados e reportados dentro do sistema.
>
> Siga este arquivo do início ao fim. Os mockups de referência estão nos anexos A e B, com código completo. Reproduza layout, textos, cores e comportamento **idênticos**.
>
> Antes de implementar, entregue um diagnóstico: o que já existe (rotas, tabelas, perfis, envio de e-mail/WhatsApp, cadastro de clientes, setores, manifestações, geração de PDF, storage), o que falta e onde cada parte vai entrar. Só implemente depois desse diagnóstico.
>
> NÃO altere a arquitetura. NÃO duplique login, menu, cadastros ou o fluxo de Nova Manifestação: reutilize. NÃO crie funcionalidades fictícias. NÃO faça deploy.

---

## 1. Visão geral do fluxo

```
Questionário publicado (por empresa)
  → Envio ao cliente (link único)
  → Cliente responde (página pública, sem login)
  → Resposta entra no Centro das Pesquisas
  → Nota ≥ 7: não requer tratamento (entra nos indicadores)
  → Nota ≤ 6: alerta "Nota baixa identificada"
        → analista decide: Ocorrência de pesquisa (OCP) | Manifestação formal (MAN) | Não requer tratamento (com justificativa)
  → Indicadores, dashboard e comentários atualizam
  → Fim do mês: Relatório de Satisfação gerado com os dados reais
        → análise crítica escrita pela Qualidade/SAC
        → publicar e enviar para Diretoria e Presidência
        → relatório fica arquivado e consultável
```

## 2. Onde entra

- Menu lateral, grupo **Gestão**: **Pesquisa de Satisfação** e **Relatórios de Satisfação**.
- Rota pública: `/pesquisa/:token` (sem login).
- Rotas internas sugeridas: `/pesquisas` (abas) e `/relatorios/satisfacao` (lista + relatório do mês).
- Empresas: CHIACCHIO EMBALAGENS, PLASCHIO, TUBAHIA. **Cada empresa tem questionário, indicadores e relatório próprios. Sem ranking entre empresas.**

## 3. Pesquisa pública (o cliente responde)

1. **Boas-vindas**: logo da empresa do envio, texto de apresentação editável, tempo estimado, botão **COMEÇAR A PESQUISA**. Selo "Sem login".
2. **Perguntas**: conforme o questionário publicado da empresa. Base atual: Recomendação (NPS 0–10), Qualidade dos produtos, Prazo de entrega, Atendimento, Motivo da compra, comentário aberto.
3. **Confirmação**: agradecimento editável com o logo da empresa e botão **FECHAR**.

Regras:
- Token único por envio; resposta única (segundo acesso mostra "pesquisa já respondida").
- Link expira (prazo configurável, ex.: 30 dias).
- Mobile first; obrigatórias validadas antes de avançar; progresso salvo se o cliente fechar no meio.
- Também deve existir **link geral por empresa** (seção "Links das pesquisas públicas") para uso em QR code/assinatura de e-mail; nesse caso pedir CNPJ ou nome da empresa no início.

## 4. Envio

- Envio individual (a partir do cliente ou de uma manifestação encerrada) e envio em lote (lista de clientes por empresa/período).
- Canais: e-mail e WhatsApp (usar integrações existentes; se não houver, apenas gerar link para copiar).
- Registrar: cliente, empresa, canal, enviado por, data/hora, status (Enviado, Aberto, Respondido, Expirado).
- Não reenviar a quem respondeu nos últimos 90 dias (configurável).
- Opcional: disparo automático X dias após encerrar uma manifestação.

## 5. Centro das Pesquisas (área interna, abas)

- **Visão geral**: card "Como uma resposta é tratada" com os três caminhos (OCORRÊNCIA DE PESQUISA · OCP / MANIFESTAÇÃO FORMAL · MAN / NÃO REQUER TRATAMENTO) e lista "Pesquisas recebidas" com destaque **NOTA ≤ 6**.
- **Por ano e mês**: árvore ano ▸ mês com quantidade de respostas, média e notas baixas.
- **Por empresa**: indicadores de cada empresa calculados separadamente.
- **Dashboard**: indicador geral, NPS, médias por pergunta, evolução mensal, taxa de resposta, motivo da compra; filtros por empresa e período.
- **Comentários**: comentários abertos com filtro por empresa, nota, período e palavra.
- **Ocorrências**: lista das OCPs com status, setor, responsável e prazo.
- **Questionário**: editor (item 7).
- **Notificações**: por setor, ocorrências recebidas e pendentes.

Ao abrir uma resposta: **Detalhes da pesquisa** (cliente, empresa, data, canal, versão do questionário, todas as respostas, comentário).

## 6. Tratamento de nota baixa

- Nota ≤ 6 em qualquer pergunta de nota (limite configurável) marca a resposta: **NOTA BAIXA IDENTIFICADA AUTOMATICAMENTE**.
- **Análise da nota baixa**: sistema mostra **SETOR SUGERIDO** (pela pergunta com nota baixa e pelo comentário; IA só sugere). Analista escolhe:
  1. **GERAR OCORRÊNCIA** → cria **Ocorrência de pesquisa (OCP-xxxx)**: "NOVA OCORRÊNCIA DE PESQUISA · não é manifestação formal". Fluxo: Encaminhar ao setor → Iniciar tratamento → Registrar tratativa e encerrar. Tem histórico próprio. **Não entra nos indicadores de manifestação.**
  2. **TRANSFORMAR EM MANIFESTAÇÃO** → confirmação explícita → abre o fluxo existente de Nova Manifestação com dados pré-preenchidos e **ORIGEM = PESQUISA DE SATISFAÇÃO**, **ID DA PESQUISA** e link **VER PESQUISA ORIGINAL**. Status inicial: "Registrada · aguardando análise do SAC".
  3. **NÃO REQUER TRATAMENTO** → exige **JUSTIFICAR DECISÃO**.
- **Histórico e rastreabilidade**: resposta → decisão (quem, quando, justificativa) → OCP/MAN → tratativa → encerramento.
- Prazo de decisão sobre nota baixa (ex.: 48 h); aparece em "Minha Central SAC" e notificações quando vencer.

## 7. Editor do questionário

- Um questionário por empresa, com **versões**: Rascunho → **Publicar** → Publicado (anterior vai para Arquivado).
- Adicionar, editar, remover, reordenar (arrastar) perguntas. Tipos: nota 0–10, nota 1–5, escolha única, múltipla escolha, texto. Obrigatória sim/não. Marcar quais perguntas disparam nota baixa e qual setor sugerir para cada uma.
- **Textos da pesquisa**: boas-vindas e agradecimento.
- **Pré-visualizar** como o cliente verá, antes de publicar.
- Respostas ficam vinculadas à versão respondida; indicadores comparam só perguntas equivalentes entre versões.
- Somente perfis autorizados pelo MASTER editam/publicam. Auditoria de cada alteração.

## 8. Relatórios de Satisfação (mensal)

Substitui o relatório que hoje é montado à mão e enviado todo mês à Diretoria e Presidência. Deve ser **dinâmico**: os números saem das respostas reais; a pessoa só escreve a análise.

### 8.1 Lista "Relatórios de satisfação"
- Um relatório por **empresa + mês**. Colunas: mês, empresa, indicador do mês, status (Rascunho / Publicado), publicado por, data, enviados para.
- Botão para gerar o relatório do mês (cria em Rascunho com os dados do mês fechado).

### 8.2 Conteúdo do relatório (seguir o mockup, nesta ordem)
1. **Cabeçalho**: "RELATÓRIO DE PESQUISA DE SATISFAÇÃO DE CLIENTES", logo da empresa, mês/ano.
2. **META DE SATISFAÇÃO GERAL** (configurável por empresa) e **INDICADOR DO MÊS**, com indicação de atingido/não atingido.
3. **Evolução do indicador**: gráfico mês a mês (ex.: "Desde nov/25") com a linha da meta.
4. **Resultado mensal**: tabela/gráfico por pergunta (Recomendação/NPS, Qualidade dos produtos, Prazo de entrega, Atendimento), quantidade de respostas, taxa de resposta, comparação com mês anterior.
5. **Motivo da compra**: distribuição das respostas.
6. **Notas baixas e tratativas**: quantas notas ≤ 6, quantas viraram OCP, MAN ou não requer tratamento, status de cada uma.
7. **Análise mensal dos resultados** (texto escrito pela Qualidade/SAC, campos editáveis): **Desempenho geral**, **Análise crítica dos resultados**, **Pontos fortes**, **Oportunidades de melhoria**, **Ações recomendadas**. A IA pode sugerir um rascunho, rotulado "Sugestão da IA"; a pessoa revisa.
8. **Envios deste relatório**: quem recebeu, quando, quem abriu.

### 8.3 Publicação e envio
- Botão **Publicar e enviar** / **Enviar para Diretoria e Presidência**: confirmação, gera **PDF** no layout do mockup, envia por e-mail para a lista de destinatários configurada (Diretoria e Presidência) com link para a versão online.
- Após publicar, números e texto ficam **congelados** (snapshot). Correção = nova versão, mantendo a anterior.
- Relatório publicado fica arquivado e consultável; PDF guardado em storage persistente (na Vercel, usar storage externo, não o disco do servidor).
- Perfil DIRETORIA/PRESIDÊNCIA: leitura da versão online e do PDF.

### 8.4 Cálculos (definir no diagnóstico com base no relatório atual)
- Indicador de satisfação geral (ex.: % de notas ≥ 7 ou média ponderada; manter a fórmula usada hoje).
- NPS = % promotores (9–10) − % detratores (0–6).
- Taxa de resposta = respondidas / enviadas no mês.
- Mês da resposta = data em que o cliente respondeu.
- Importar o histórico das planilhas antigas (via tela Alimentação da ferramenta) para a evolução mensal começar já com dados.

## 9. Dados (mínimo)

```
Questionario { id, empresa, versao, status (RASCUNHO|PUBLICADO|ARQUIVADO), texto_boas_vindas, texto_agradecimento, publicado_por, publicado_em }
Pergunta { id, questionario_id, ordem, tipo, texto, obrigatoria, opcoes, dispara_nota_baixa, setor_sugerido }
Envio { id, empresa, cliente_id, manifestacao_id?, token, canal, enviado_por, enviado_em, aberto_em, respondido_em, expira_em, status }
Resposta { id, envio_id, questionario_id, versao, respostas (json), comentario, nota_baixa, decisao (OCP|MAN|SEM_TRATAMENTO|PENDENTE), justificativa, decidido_por, decidido_em }
Ocorrencia { id (OCP-xxxx), resposta_id, empresa, setor, descricao, status, responsavel, prazo, tratativa, encerrada_em }
VinculoManifestacao { resposta_id, manifestacao_id }
Relatorio { id, empresa, mes, ano, versao, status (RASCUNHO|PUBLICADO), meta, indicador, dados_snapshot (json), analise (json: desempenho, critica, fortes, melhorias, acoes), pdf_url, publicado_por, publicado_em }
EnvioRelatorio { id, relatorio_id, destinatario, enviado_em, aberto_em }
```

## 10. Permissões

- Usuário vê só as empresas a que tem acesso; MASTER global. Validar no backend por empresa e por ID (403 fora do escopo), inclusive na rota do PDF.
- Setor vê só as OCPs do seu setor.
- Editar/publicar questionário e publicar relatório: perfis definidos pelo MASTER.
- DIRETORIA/PRESIDÊNCIA: leitura de dashboard e relatórios publicados.
- Auditoria: envio, resposta, decisão de nota baixa, OCP, conversão em manifestação, edição/publicação de questionário, geração/publicação/envio de relatório.

## 11. Identidade visual

Montserrat 400–700; vermelho #C70602 (hover #A80502, escuro #7F0401); texto #1F1F1F / #666464 / #929090; bordas #E4E4E4; fundo #F4F4F4; cards brancos raio 12 px; ocorrência de pesquisa em #FFFBEF com borda #D9A400. Logos de Chiacchio Embalagens, Plaschio e Tubahia na pesquisa pública e no relatório.

## 12. Testes obrigatórios

1. Criar rascunho de questionário, editar perguntas e textos, pré-visualizar, publicar; versão anterior arquivada.
2. Enviar pesquisa individual e em lote; responder pelo link no celular; tentar responder de novo (bloqueado); link expirado.
3. Logo e textos corretos por empresa.
4. Nota baixa → OCP → encaminhar → tratar → encerrar.
5. Nota baixa → manifestação formal com origem e link para a pesquisa original.
6. Nota baixa → não requer tratamento sem justificativa (bloqueado) e com justificativa.
7. Dashboard, por empresa e por ano/mês batendo com as respostas.
8. Gerar relatório do mês, escrever análise, publicar, gerar PDF, enviar; conferir números contra as respostas.
9. Corrigir relatório publicado → nova versão, anterior preservada.
10. Usuário de outra empresa acessando pesquisa, OCP ou PDF pelo ID → 403.
11. Persistência após atualizar página, logout/login e novo deploy.

## 13. Entrega

Diagnóstico; arquivos alterados; rotas e endpoints; tabelas; fórmulas dos indicadores; onde ficam os PDFs; como pesquisa se liga a OCP e manifestação; testes executados; pendências.

---

## Anexo A — mockup PesquisaSatisfacao.dc.html

````html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<title>Pesquisa de Satisfação · Grupo Chiacchio</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
<style>
body{margin:0;background:#F4F4F4;color:#1F1F1F;font-family:Montserrat,system-ui,sans-serif;font-size:14px;-webkit-font-smoothing:antialiased}
button,input,select,textarea{font:inherit;color:inherit}button{white-space:nowrap}
a{color:#A80502;text-decoration:none}a:hover{color:#7F0401;text-decoration:underline}
*{box-sizing:border-box}
@keyframes pulse{0%,100%{opacity:.55}50%{opacity:1}}
</style>
</helmet>
<div style="min-height:100vh;font-family:Montserrat,system-ui,sans-serif;color:#1F1F1F">

<sc-if value="{{ isPub }}" hint-placeholder-val="{{ true }}">
<div data-screen-label="Pesquisa pública" style="min-height:100vh;background:#F4F4F4;display:flex;flex-direction:column">
  <div style="background:#1F1F1F;color:#fff;padding:8px 14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px">
    <span style="font-weight:700;letter-spacing:.08em;color:#FFC2BF">PROTÓTIPO</span>
    <span style="color:#BDBDBD">barra só do mockup · o cliente não vê</span>
    <span style="background:#333;border-radius:6px;padding:4px 10px;font-family:ui-monospace,monospace;white-space:nowrap">{{ pubUrl }}</span>
    <sc-for list="{{ pubEmps }}" as="e" hint-placeholder-count="3"><button onClick="{{ e.go }}" style="border:1px solid {{ e.bd }};background:{{ e.bg }};color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;white-space:nowrap">{{ e.l }}</button></sc-for>
    <button onClick="{{ toggleToken }}" style="border:1px solid #555;background:transparent;color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;white-space:nowrap">{{ tokenLabel }}</button>
    <button onClick="{{ goInternal }}" style="margin-left:auto;border:0;background:#C70602;color:#fff;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap">Ir para a área interna →</button>
  </div>

  <sc-if value="{{ preview }}"><div style="background:#FBF0D9;color:#5E3B00;padding:9px 14px;font-size:12.5px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><strong>PRÉ-VISUALIZAÇÃO DO RASCUNHO</strong><span>Questionário ainda não publicado · respostas não são registradas</span><button onClick="{{ backEditor }}" style="margin-left:auto;border:1px solid #7A4C00;background:transparent;color:#5E3B00;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;font-weight:600">Voltar ao editor</button></div></sc-if>
  <sc-if value="{{ showWelcome }}" hint-placeholder-val="{{ true }}">
  <div data-screen-label="Boas-vindas" style="flex:1;display:grid;place-items:center;padding:24px 14px 40px">
    <div style="width:100%;max-width:560px;background:#fff;border:1px solid #E4E4E4;border-radius:18px;overflow:hidden;display:flex;flex-direction:column">
      <div style="padding:28px 26px 22px;display:flex;justify-content:center;border-bottom:1px solid #EFEFEF">
        <img src="{{ brand.logo }}" alt="{{ brand.l }}" style="height:62px;max-width:100%;width:auto;display:block">
      </div>
      <div style="background:{{ brand.c }};color:#fff;padding:30px 26px;display:flex;flex-direction:column;gap:12px;text-align:center;align-items:center">
        <div style="font-size:13px;font-weight:600;letter-spacing:.12em;color:{{ brand.soft }}">PESQUISA DE SATISFAÇÃO</div>
        <div style="font-size:25px;font-weight:700;line-height:1.25">{{ qt.wT }}</div>
        <div style="font-size:15px;line-height:1.6;max-width:420px;white-space:pre-line">{{ qt.wX }}</div>
      </div>
      <div style="padding:22px 26px 26px;display:flex;flex-direction:column;gap:16px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">
          <div style="background:#F4F4F4;border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:2px"><span style="font-size:20px;font-weight:700">1 min</span><span style="font-size:12.5px;color:#545252">tempo médio de resposta</span></div>
          <div style="background:#F4F4F4;border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:2px"><span style="font-size:20px;font-weight:700">{{ qt.nNotas }}</span><span style="font-size:12.5px;color:#545252">de 0 a 10, com um toque</span></div>
          <div style="background:#F4F4F4;border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:2px"><span style="font-size:20px;font-weight:700">Sem login</span><span style="font-size:12.5px;color:#545252">é só responder e enviar</span></div>
        </div>
        <sc-if value="{{ token }}"><div style="background:#FFF8F8;border:1px solid #F3CFCF;border-radius:10px;padding:10px 14px;font-size:13px;line-height:1.5">Esta pesquisa foi enviada para <strong>{{ tokenCli }}</strong>. Seus dados já estarão preenchidos.</div></sc-if>
        <button onClick="{{ start }}" style="height:56px;border:0;background:{{ brand.c }};color:#fff;border-radius:12px;font-size:16px;font-weight:700;letter-spacing:.06em;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.18)">COMEÇAR A PESQUISA</button>
        <div style="text-align:center;font-size:11.5px;color:#929090;line-height:1.5">Seus dados são usados apenas para o atendimento e a melhoria dos nossos serviços.</div>
      </div>
    </div>
  </div>
  </sc-if>

  <sc-if value="{{ showForm }}">
  <div style="width:100%;max-width:680px;margin:0 auto;padding:20px 14px 56px;display:flex;flex-direction:column;gap:14px">
    <div style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid #E4E4E4">
      <div style="padding:16px 22px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #EFEFEF;min-height:76px">
        <img src="{{ brand.logo }}" alt="{{ brand.l }}" style="height:50px;max-width:100%;width:auto;display:block">
      </div>
      <div style="background:{{ brand.c }};color:#fff;padding:26px 22px 22px;display:flex;flex-direction:column;gap:10px">
        <div style="font-size:23px;font-weight:700;line-height:1.25;text-transform:uppercase">{{ qt.hT }}</div>
        <div style="font-size:14.5px;line-height:1.55;font-weight:600">{{ qt.h1 }}</div>
        <div style="font-size:14px;line-height:1.55">{{ qt.h2 }}</div>
        <div style="font-size:12px;color:{{ brand.soft }}">* Indica uma pergunta obrigatória</div>
      </div>
    </div>

    <sc-for list="{{ pubSecs }}" as="sec" hint-placeholder-count="3">
    <div style="background:#fff;border-radius:14px;border:1px solid #E4E4E4;padding:20px 22px;display:flex;flex-direction:column;gap:22px">
      <div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:{{ brand.c }}">{{ sec.l }}</div>
      <sc-for list="{{ sec.items }}" as="q">
        <div id="{{ q.id }}" style="display:flex;flex-direction:column;gap:8px">
          <div style="font-size:14.5px;font-weight:600;line-height:1.45">{{ q.l }}<sc-if value="{{ q.req }}"><span style="color:{{ brand.c }}"> *</span></sc-if></div>
          <sc-if value="{{ q.help }}"><div style="font-size:12.5px;color:#666464;line-height:1.45;margin-top:-4px">{{ q.help }}</div></sc-if>
          <sc-if value="{{ q.isCampo }}"><input value="{{ q.v }}" onChange="{{ q.on }}" placeholder="{{ q.ph }}" type="{{ q.type }}" inputMode="{{ q.mode }}" style="height:48px;border:1.5px solid {{ q.bc }};border-radius:9px;padding:0 14px;font-size:16px;background:#fff"></sc-if>
          <sc-if value="{{ q.isLongo }}"><textarea rows="4" value="{{ q.v }}" onChange="{{ q.on }}" placeholder="Sua resposta" style="border:1.5px solid {{ q.bc }};border-radius:9px;padding:12px 14px;font-size:16px;line-height:1.5;resize:vertical;background:#fff"></textarea></sc-if>
          <sc-if value="{{ q.isEscala }}">
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(46px,1fr));gap:6px"><sc-for list="{{ q.nums }}" as="b"><button onClick="{{ b.go }}" aria-label="{{ b.aria }}" style="height:48px;border-radius:9px;border:1.5px solid {{ b.bd }};background:{{ b.bg }};color:{{ b.fg }};font-size:16px;font-weight:700;cursor:pointer;font-variant-numeric:tabular-nums">{{ b.n }}</button></sc-for></div>
            <div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;color:#666464"><span>0 · {{ q.lo }}</span><span>10 · {{ q.hi }}</span></div>
          </sc-if>
          <sc-if value="{{ q.isEscolha }}">
            <sc-for list="{{ q.opts }}" as="o"><button onClick="{{ o.go }}" style="display:flex;align-items:center;gap:12px;min-height:48px;border:1.5px solid {{ o.bd }};background:{{ o.bg }};border-radius:9px;padding:0 14px;cursor:pointer;text-align:left;font-size:15px;white-space:normal"><span style="width:20px;height:20px;border-radius:{{ o.rad }};border:2px solid {{ o.rc }};display:grid;place-items:center;flex:none"><span style="width:10px;height:10px;border-radius:{{ o.rad2 }};background:{{ o.dot }}"></span></span>{{ o.l }}</button></sc-for>
            <sc-if value="{{ q.showOutro }}"><input value="{{ q.outroV }}" onChange="{{ q.onOutro }}" placeholder="Qual?" style="height:48px;border:1.5px solid {{ q.bc }};border-radius:9px;padding:0 14px;font-size:16px;background:#fff"></sc-if>
          </sc-if>
          <sc-if value="{{ q.err }}"><span style="font-size:12.5px;color:#A80502;font-weight:500">{{ q.err }}</span></sc-if>
        </div>
      </sc-for>
    </div>
    </sc-for>

    <sc-if value="{{ errCount }}"><div style="background:#FDECEC;color:#7F0401;border-radius:10px;padding:12px 16px;font-size:13.5px">{{ errCount }} resposta(s) obrigatória(s) pendente(s). Revise os campos destacados.</div></sc-if>
    <button onClick="{{ submit }}" style="height:56px;border:0;background:{{ brand.c }};color:#fff;border-radius:12px;font-size:16px;font-weight:700;letter-spacing:.06em;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.18)">{{ submitL }}</button>
    <div style="text-align:center;font-size:11.5px;color:#929090;line-height:1.5">{{ brand.l }} · Grupo Chiacchio. Seus dados são usados apenas para o atendimento e a melhoria dos nossos serviços.</div>
  </div>
  </sc-if>

  <sc-if value="{{ showThanks }}">
  <div data-screen-label="Confirmação" style="flex:1;display:grid;place-items:center;padding:28px 14px">
    <div style="width:100%;max-width:520px;background:#fff;border:1px solid #E4E4E4;border-radius:16px;padding:34px 26px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center">
      <img src="{{ brand.logo }}" alt="{{ brand.l }}" style="height:44px;max-width:100%;width:auto;display:block">
      <div style="width:64px;height:64px;border-radius:50%;background:#E6F2EA;color:#1E6B3A;display:grid;place-items:center;font-size:30px;font-weight:700">✓</div>
      <div style="font-size:22px;font-weight:700;line-height:1.3">{{ qt.tT }}</div>
      <div style="font-size:15px;line-height:1.55;color:#3A3939;white-space:pre-line">{{ qt.tX }}</div>
      <sc-if value="{{ notPreview }}"><div style="font-size:12px;color:#929090">Protocolo {{ sentId }}</div></sc-if><sc-if value="{{ preview }}"><div style="font-size:12px;color:#7A4C00;background:#FBF0D9;border-radius:6px;padding:6px 10px">Pré-visualização: nenhuma resposta foi registrada.</div></sc-if>
      <sc-if value="{{ notClosed }}"><button onClick="{{ closeThanks }}" style="height:50px;min-width:200px;border:0;background:{{ brand.c }};color:#fff;border-radius:10px;font-weight:700;letter-spacing:.06em;cursor:pointer">FECHAR</button></sc-if>
      <sc-if value="{{ closed }}"><div style="font-size:13.5px;color:#545252;background:#F4F4F4;border-radius:8px;padding:10px 14px">Você já pode fechar esta janela.</div></sc-if>
    </div>
  </div>
  </sc-if>
</div>
</sc-if>

<sc-if value="{{ isInt }}">
<div style="display:flex;flex-wrap:wrap;min-height:100vh;background:#F4F4F4">
  <aside style="flex:0 0 220px;background:#fff;border-right:1px solid #E4E4E4;padding:16px 12px;display:flex;flex-direction:column;gap:3px">
    <div style="display:flex;align-items:center;gap:10px;padding:2px 8px 16px"><img src="assets/simbolo-vermelho.png" alt="" style="width:28px;height:auto"><div><div style="font-weight:700;font-size:13.5px">Assistente SAC</div><div style="font-size:10.5px;color:#929090;letter-spacing:.06em">GRUPO CHIACCHIO</div></div></div>
    <sc-for list="{{ navG }}" as="g">
      <div style="font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#929090;font-weight:600;padding:10px 10px 4px">{{ g.l }}</div>
      <sc-for list="{{ g.items }}" as="it"><a href="{{ it.href }}" onClick="{{ it.go }}" style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:7px;font-size:13px;white-space:nowrap;color:{{ it.fg }};background:{{ it.bg }};font-weight:{{ it.fw }};text-decoration:none">{{ it.l }}<sc-if value="{{ it.badge }}"><span style="background:#C70602;color:#fff;border-radius:99px;padding:1px 7px;font-size:10.5px;font-weight:700">{{ it.badge }}</span></sc-if></a></sc-for>
    </sc-for>
    <div style="margin-top:auto;border-top:1px solid #E4E4E4;padding:12px 10px 0;font-size:12px;color:#666464;display:flex;flex-direction:column;gap:4px"><span style="font-weight:600;color:#1F1F1F">Luiza Martins</span><span>SAC · acesso autorizado</span><button onClick="{{ goPublic }}" style="border:0;background:none;padding:4px 0 0;color:#A80502;cursor:pointer;text-align:left;font-size:12px">Ver área pública (cliente)</button></div>
  </aside>

  <main style="flex:1 1 640px;min-width:0;padding:20px 24px 56px;display:flex;flex-direction:column;gap:16px">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap">
      <div><div style="font-size:12px;color:#929090">Relacionamento / Pesquisa de satisfação</div><div style="font-size:22px;font-weight:700;letter-spacing:.01em">CENTRO DAS PESQUISAS</div><div style="font-size:13px;color:#666464;margin-top:2px">Respostas das pesquisas públicas da Chiacchio, Plaschio e Tubahia, com análise das notas e rastreabilidade.</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        <button onClick="{{ goNotifs }}" style="position:relative;border:1px solid #D6D6D6;background:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:13px;white-space:nowrap">Notificações<sc-if value="{{ unread }}"><span style="margin-left:6px;background:#C70602;color:#fff;border-radius:99px;padding:1px 7px;font-size:11px;font-weight:700">{{ unread }}</span></sc-if></button>
        <a href="RelatorioSatisfacao.dc.html" style="border:1px solid #1F1F1F;background:#fff;color:#1F1F1F;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;white-space:nowrap;text-decoration:none">Relatórios mensais</a>
        <button onClick="{{ openLinks }}" style="border:0;background:#C70602;color:#fff;border-radius:8px;padding:9px 14px;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap">Links das pesquisas</button>
      </div>
    </div>

    <div style="display:flex;gap:2px;border-bottom:1px solid #E4E4E4;overflow-x:auto;scrollbar-width:none">
      <sc-for list="{{ tabs }}" as="t" hint-placeholder-count="7"><button onClick="{{ t.go }}" style="border:0;background:none;padding:10px 14px;font-size:13px;cursor:pointer;white-space:nowrap;color:{{ t.fg }};border-bottom:2px solid {{ t.bd }};margin-bottom:-1px;font-weight:{{ t.fw }}">{{ t.l }}<sc-if value="{{ t.n }}"><span style="margin-left:6px;background:#C70602;color:#fff;border-radius:99px;padding:0 6px;font-size:10.5px;font-weight:700">{{ t.n }}</span></sc-if></button></sc-for>
    </div>

    <sc-if value="{{ needFilters }}">
    <div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:12px 14px;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
      <sc-for list="{{ fSelects }}" as="s"><label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:#666464;font-weight:600">{{ s.l }}<select value="{{ s.v }}" onChange="{{ s.on }}" style="height:34px;border:1px solid {{ s.bd }};border-radius:7px;padding:0 8px;background:#fff;font-size:12.5px;color:#1F1F1F;font-weight:500;max-width:190px"><sc-for list="{{ s.o }}" as="o"><option value="{{ o.v }}">{{ o.l }}</option></sc-for></select></label></sc-for>
      <sc-if value="{{ fFull }}">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:#666464;font-weight:600">De<input type="date" value="{{ f.de }}" onChange="{{ onDe }}" style="height:34px;border:1px solid #D6D6D6;border-radius:7px;padding:0 6px;background:#fff;font-size:12.5px"></label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:#666464;font-weight:600">Até<input type="date" value="{{ f.ate }}" onChange="{{ onAte }}" style="height:34px;border:1px solid #D6D6D6;border-radius:7px;padding:0 6px;background:#fff;font-size:12.5px"></label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:#666464;font-weight:600;flex:1;min-width:180px">Cliente<input value="{{ f.cli }}" onChange="{{ onCli }}" placeholder="Razão social, fantasia ou CNPJ" style="height:34px;border:1px solid #D6D6D6;border-radius:7px;padding:0 10px;background:#fff;font-size:12.5px"></label>
      </sc-if>
      <button onClick="{{ clearF }}" style="height:34px;border:0;background:none;color:#A80502;cursor:pointer;font-size:12.5px;font-weight:600;padding:0 6px">Limpar filtros</button>
    </div>
    </sc-if>

<sc-if value="{{ v.geral }}">
    <div data-screen-label="Visão geral" style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><span style="font-weight:700;font-size:14px">Como uma resposta é tratada</span><span style="font-size:12px;color:#666464">Nota ≤ 6 é sinalizada para análise; ela não vira manifestação automaticamente.</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11.5px;font-weight:600">
        <sc-for list="{{ flowA }}" as="x"><span style="display:flex;gap:6px;align-items:center"><span style="background:#F4F4F4;border-radius:6px;padding:5px 9px;white-space:nowrap">{{ x.l }}</span><span style="color:#929090">→</span></span></sc-for>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
        <div style="border:1.5px solid #D9A400;background:#FFFBEF;border-radius:9px;padding:10px 12px;display:flex;flex-direction:column;gap:4px"><span style="font-size:10.5px;font-weight:700;letter-spacing:.06em;color:#7A4C00">OCORRÊNCIA DE PESQUISA · OCP</span><span style="font-size:12.5px;line-height:1.45">Sinalização para um setor avaliar. Não é reclamação formal. Tratamento → encerramento → histórico.</span></div>
        <div style="border:1.5px solid #C70602;background:#FFF8F8;border-radius:9px;padding:10px 12px;display:flex;flex-direction:column;gap:4px"><span style="font-size:10.5px;font-weight:700;letter-spacing:.06em;color:#A80502">MANIFESTAÇÃO FORMAL · MAN</span><span style="font-size:12.5px;line-height:1.45">Entra no fluxo de manifestações do SAC, vinculada à pesquisa de origem.</span></div>
        <div style="border:1.5px solid #D6D6D6;background:#FAFAFA;border-radius:9px;padding:10px 12px;display:flex;flex-direction:column;gap:4px"><span style="font-size:10.5px;font-weight:700;letter-spacing:.06em;color:#545252">NÃO REQUER TRATAMENTO</span><span style="font-size:12.5px;line-height:1.45">Decisão do SAC, sempre com justificativa registrada.</span></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px">
      <sc-for list="{{ kpis }}" as="k" hint-placeholder-count="10"><div style="background:#fff;border:1px solid #E4E4E4;border-top:3px solid {{ k.c }};border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:3px"><span style="font-size:11px;font-weight:600;letter-spacing:.04em;color:#666464">{{ k.l }}</span><span style="font-size:24px;font-weight:700;font-variant-numeric:tabular-nums">{{ k.v }}</span><span style="font-size:11.5px;color:#929090">{{ k.d }}</span></div></sc-for>
    </div>
    <div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;overflow:hidden">
      <div style="padding:12px 16px;border-bottom:1px solid #EFEFEF;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><span style="font-weight:700;font-size:14px">Pesquisas recebidas</span><span style="font-size:12px;color:#666464">{{ countTxt }}</span></div>
      <sc-if value="{{ loading }}"><div style="padding:14px 16px;display:flex;flex-direction:column;gap:8px"><sc-for list="{{ skel }}" as="x"><div style="height:30px;border-radius:6px;background:#EFEFEF;animation:pulse 1.1s ease-in-out infinite"></div></sc-for></div></sc-if>
      <sc-if value="{{ ready }}">
      <div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;min-width:980px;font-size:12.5px">
        <thead><tr style="background:#FAFAFA"><sc-for list="{{ cols }}" as="c"><th style="text-align:left;font-weight:600;font-size:11.5px;color:#666464;padding:9px 12px;border-bottom:1px solid #E4E4E4;white-space:nowrap">{{ c }}</th></sc-for></tr></thead>
        <tbody><sc-for list="{{ rows }}" as="r" hint-placeholder-count="8"><tr onClick="{{ r.go }}" style="border-bottom:1px solid #EFEFEF;cursor:pointer;background:{{ r.rb }}" style-hover="background:#FAFAFA">
          <td style="padding:9px 12px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums">{{ r.id }}</td><td style="padding:9px 12px;white-space:nowrap;color:#545252">{{ r.data }}</td><td style="padding:9px 12px">{{ r.emp }}</td><td style="padding:9px 12px;max-width:220px">{{ r.cli }}</td>
          <sc-for list="{{ r.sc }}" as="x"><td style="padding:6px 8px;text-align:center"><span style="display:inline-block;min-width:30px;padding:3px 6px;border-radius:6px;font-weight:{{ x.fw }};background:{{ x.bg }};color:{{ x.fg }};font-variant-numeric:tabular-nums">{{ x.v }}</span></td></sc-for>
          <td style="padding:9px 12px;white-space:nowrap">{{ r.canal }}</td>
          <td style="padding:9px 12px"><div style="display:flex;gap:4px;flex-wrap:wrap"><span style="padding:2px 8px;border-radius:99px;font-size:10.5px;font-weight:700;letter-spacing:.02em;white-space:nowrap;background:{{ r.st.bg }};color:{{ r.st.fg }}">{{ r.st.t }}</span><sc-if value="{{ r.low }}"><span style="padding:2px 7px;border-radius:99px;font-size:10.5px;font-weight:700;white-space:nowrap;background:#C70602;color:#fff">NOTA ≤ 6</span></sc-if></div></td>
        </tr></sc-for></tbody>
      </table></div>
      <sc-if value="{{ empty }}"><div style="padding:34px 16px;text-align:center;display:flex;flex-direction:column;gap:8px;align-items:center"><span style="font-weight:600">Nenhuma pesquisa neste recorte</span><span style="font-size:12.5px;color:#666464">Ajuste os filtros ou limpe para ver todas as respostas.</span><button onClick="{{ clearF }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:7px;padding:7px 12px;cursor:pointer;font-size:12.5px">Limpar filtros</button></div></sc-if>
      <sc-if value="{{ more }}"><div style="padding:10px;text-align:center"><button onClick="{{ loadMore }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:7px;padding:7px 14px;cursor:pointer;font-size:12.5px">Carregar mais</button></div></sc-if>
      </sc-if>
    </div>
</sc-if>

<sc-if value="{{ v.anomes }}">
    <div data-screen-label="Por ano e mês" style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start">
      <div style="flex:1 1 230px;max-width:100%;background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:2px">
        <sc-for list="{{ tree }}" as="y" hint-placeholder-count="2">
          <button onClick="{{ y.go }}" style="display:flex;justify-content:space-between;border:0;background:none;padding:8px 8px;cursor:pointer;font-weight:700;font-size:14px;text-align:left"><span>{{ y.sign }} {{ y.l }}</span><span style="font-size:12px;color:#929090;font-weight:500">{{ y.n }}</span></button>
          <sc-if value="{{ y.open }}"><sc-for list="{{ y.months }}" as="m">
            <button onClick="{{ m.go }}" style="display:flex;justify-content:space-between;border:0;background:{{ m.bg }};border-radius:6px;padding:7px 8px 7px 22px;cursor:pointer;font-size:13px;font-weight:600;text-align:left"><span>{{ m.sign }} {{ m.l }}</span><span style="font-size:12px;color:#929090;font-weight:500">{{ m.n }}</span></button>
            <sc-if value="{{ m.open }}"><sc-for list="{{ m.emps }}" as="e"><button onClick="{{ e.go }}" style="display:flex;justify-content:space-between;border:0;border-left:2px solid {{ e.bl }};background:{{ e.bg }};padding:6px 8px 6px 14px;margin-left:30px;cursor:pointer;font-size:12.5px;color:{{ e.fg }};font-weight:{{ e.fw }};text-align:left"><span>{{ e.l }}</span><span style="font-variant-numeric:tabular-nums">{{ e.n }}</span></button></sc-for></sc-if>
          </sc-for></sc-if>
        </sc-for>
      </div>
      <div style="flex:999 1 560px;min-width:0;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:15px;font-weight:700"><sc-for list="{{ crumbT }}" as="c"><span style="display:flex;gap:8px;align-items:center">{{ c.l }}<span style="color:#929090;font-weight:400">{{ c.a }}</span></span></sc-for></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px"><sc-for list="{{ tKpis }}" as="k"><div style="background:#fff;border:1px solid #E4E4E4;border-top:3px solid {{ k.c }};border-radius:10px;padding:10px 12px"><div style="font-size:11px;font-weight:600;color:#666464">{{ k.l }}</div><div style="font-size:21px;font-weight:700">{{ k.v }}</div></div></sc-for></div>
        <div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;overflow-x:auto">
          <table style="border-collapse:collapse;width:100%;min-width:820px;font-size:12.5px">
            <thead><tr style="background:#FAFAFA"><sc-for list="{{ cols2 }}" as="c"><th style="text-align:left;font-weight:600;font-size:11.5px;color:#666464;padding:9px 12px;border-bottom:1px solid #E4E4E4;white-space:nowrap">{{ c }}</th></sc-for></tr></thead>
            <tbody><sc-for list="{{ tRows }}" as="r"><tr onClick="{{ r.go }}" style="border-bottom:1px solid #EFEFEF;cursor:pointer" style-hover="background:#FAFAFA"><td style="padding:9px 12px;font-weight:600;white-space:nowrap">{{ r.id }}</td><td style="padding:9px 12px;white-space:nowrap;color:#545252">{{ r.data }}</td><td style="padding:9px 12px">{{ r.cli }}</td><sc-for list="{{ r.sc }}" as="x"><td style="padding:6px 8px;text-align:center"><span style="display:inline-block;min-width:30px;padding:3px 6px;border-radius:6px;font-weight:{{ x.fw }};background:{{ x.bg }};color:{{ x.fg }}">{{ x.v }}</span></td></sc-for><td style="padding:9px 12px"><span style="padding:2px 8px;border-radius:99px;font-size:10.5px;font-weight:700;white-space:nowrap;background:{{ r.st.bg }};color:{{ r.st.fg }}">{{ r.st.t }}</span></td></tr></sc-for></tbody>
          </table>
          <sc-if value="{{ tEmpty }}"><div style="padding:24px;text-align:center;font-size:12.5px;color:#666464">Nenhuma pesquisa para este mês e empresa.</div></sc-if>
        </div>
      </div>
    </div>
</sc-if>

<sc-if value="{{ v.empresa }}">
    <div data-screen-label="Por empresa" style="font-size:12.5px;color:#666464">Indicadores de cada empresa calculados separadamente, no recorte de ano e mês selecionado. Sem ranking entre empresas.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:14px">
      <sc-for list="{{ empCards }}" as="e" hint-placeholder-count="3">
        <div style="background:#fff;border:1px solid #E4E4E4;border-radius:12px;overflow:hidden;display:flex;flex-direction:column">
          <div style="padding:14px 16px;border-bottom:2px solid #C70602;display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-weight:700;font-size:16px;letter-spacing:.04em">{{ e.up }}</span><span style="font-size:11px;color:#929090;font-family:ui-monospace,monospace">{{ e.url }}</span></div>
          <div style="padding:12px 16px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px">
            <sc-for list="{{ e.k }}" as="k"><div><div style="font-size:10.5px;font-weight:600;color:#666464;letter-spacing:.03em">{{ k.l }}</div><div style="font-size:18px;font-weight:700;color:{{ k.c }};font-variant-numeric:tabular-nums">{{ k.v }}</div></div></sc-for>
          </div>
          <div style="padding:10px 16px 14px;border-top:1px solid #EFEFEF;display:flex;flex-direction:column;gap:6px"><span style="font-size:11px;color:#666464;font-weight:600">NPS · últimos 6 meses</span><div style="display:flex;align-items:flex-end;gap:6px;height:70px"><sc-for list="{{ e.spark }}" as="b"><div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;height:100%;justify-content:flex-end"><span style="font-size:10px;color:#545252">{{ b.v }}</span><div style="width:100%;max-width:26px;height:{{ b.h }};background:#C70602;border-radius:3px 3px 0 0"></div><span style="font-size:9.5px;color:#929090">{{ b.l }}</span></div></sc-for></div></div>
          <button onClick="{{ e.go }}" style="margin:0 16px 16px;height:38px;border:1px solid #C70602;background:#fff;color:#C70602;border-radius:8px;cursor:pointer;font-weight:700;font-size:12px;letter-spacing:.04em" style-hover="background:#C70602;color:#fff">VER PESQUISAS DA {{ e.up }}</button>
        </div>
      </sc-for>
    </div>
</sc-if>

<sc-if value="{{ v.dash }}">
    <div data-screen-label="Dashboard" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <sc-for list="{{ dEmpChips }}" as="c"><button onClick="{{ c.go }}" style="border:1px solid {{ c.bd }};background:{{ c.bg }};color:{{ c.fg }};border-radius:99px;padding:6px 12px;font-size:12.5px;cursor:pointer">{{ c.l }}</button></sc-for>
      <span style="width:1px;height:22px;background:#D6D6D6"></span>
      <sc-for list="{{ dPerChips }}" as="c"><button onClick="{{ c.go }}" style="border:1px solid {{ c.bd }};background:{{ c.bg }};color:{{ c.fg }};border-radius:99px;padding:6px 12px;font-size:12.5px;cursor:pointer">{{ c.l }}</button></sc-for>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:14px">
      <sc-for list="{{ charts }}" as="ch" hint-placeholder-count="10">
        <div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:10px">
          <div><div style="font-weight:700;font-size:13.5px">{{ ch.t }}</div><div style="font-size:11.5px;color:#929090">{{ ch.s }}</div></div>
          <div style="display:flex;align-items:flex-end;gap:4px;height:130px"><sc-for list="{{ ch.items }}" as="b"><div style="flex:1;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px"><span style="font-size:9.5px;color:#545252;white-space:nowrap">{{ b.v }}</span><div style="width:100%;max-width:24px;height:{{ b.h }};background:{{ b.c }};border-radius:3px 3px 0 0"></div><span style="font-size:9.5px;color:#929090;white-space:nowrap">{{ b.l }}</span></div></sc-for></div>
        </div>
      </sc-for>
    </div>
</sc-if>

<sc-if value="{{ v.coment }}">
    <div data-screen-label="Comentários" style="display:flex;gap:6px;flex-wrap:wrap"><sc-for list="{{ cChips }}" as="c"><button onClick="{{ c.go }}" style="border:1px solid {{ c.bd }};background:{{ c.bg }};color:{{ c.fg }};border-radius:99px;padding:6px 12px;font-size:12.5px;cursor:pointer">{{ c.l }} <span style="opacity:.7">{{ c.n }}</span></button></sc-for></div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <sc-for list="{{ coms }}" as="c" hint-placeholder-count="5">
        <button onClick="{{ c.go }}" style="text-align:left;background:#fff;border:1px solid #E4E4E4;border-left:3px solid {{ c.lc }};border-radius:10px;padding:14px 16px;cursor:pointer;display:flex;flex-direction:column;gap:8px;white-space:normal" style-hover="border-color:#C70602">
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><span style="font-weight:700;font-size:13.5px">{{ c.cli }}</span><span style="font-size:12px;color:#666464">{{ c.emp }} · {{ c.data }} · {{ c.id }}</span><span style="margin-left:auto;padding:2px 8px;border-radius:99px;font-size:10.5px;font-weight:700;white-space:nowrap;background:{{ c.st.bg }};color:{{ c.st.fg }}">{{ c.st.t }}</span></div>
          <div style="font-size:14px;line-height:1.55">“{{ c.coment }}”</div>
          <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:#545252"><span>Menor nota: <strong style="color:{{ c.nc }}">{{ c.nota }}</strong> · {{ c.perg }}</span><span>Setor sugerido: <strong>{{ c.setor }}</strong></span></div>
        </button>
      </sc-for>
      <sc-if value="{{ cEmpty }}"><div style="background:#fff;border:1px dashed #CFCFCF;border-radius:10px;padding:28px;text-align:center;color:#666464;font-size:13px">Nenhum comentário neste filtro.</div></sc-if>
      <sc-if value="{{ cMore }}"><button onClick="{{ cLoadMore }}" style="align-self:center;border:1px solid #D6D6D6;background:#fff;border-radius:7px;padding:7px 14px;cursor:pointer;font-size:12.5px">Carregar mais</button></sc-if>
    </div>
</sc-if>

<sc-if value="{{ v.ocs }}">
    <div data-screen-label="Ocorrências" style="font-size:12.5px;color:#666464;line-height:1.5">Ocorrências de pesquisa são sinalizações a um setor. Elas não são manifestações formais e não entram no fluxo de tratativa do SAC.</div>
    <div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;overflow-x:auto">
      <table style="border-collapse:collapse;width:100%;min-width:980px;font-size:12.5px">
        <thead><tr style="background:#FFFBEF"><sc-for list="{{ ocCols }}" as="c"><th style="text-align:left;font-weight:600;font-size:11.5px;color:#7A4C00;padding:9px 12px;border-bottom:1px solid #F1E2B5;white-space:nowrap">{{ c }}</th></sc-for></tr></thead>
        <tbody><sc-for list="{{ ocRows }}" as="o" hint-placeholder-count="5"><tr onClick="{{ o.go }}" style="border-bottom:1px solid #EFEFEF;cursor:pointer" style-hover="background:#FAFAFA"><td style="padding:9px 12px;font-weight:700;white-space:nowrap;color:#7A4C00">{{ o.id }}</td><td style="padding:9px 12px;white-space:nowrap">{{ o.pesq }}</td><td style="padding:9px 12px">{{ o.emp }}</td><td style="padding:9px 12px">{{ o.cli }}</td><td style="padding:9px 12px">{{ o.perg }}</td><td style="padding:9px 12px;font-weight:700;color:#A80502">{{ o.nota }}</td><td style="padding:9px 12px;white-space:nowrap">{{ o.setor }}</td><td style="padding:9px 12px;white-space:nowrap">{{ o.resp }}</td><td style="padding:9px 12px;white-space:nowrap">{{ o.prazo }}</td><td style="padding:9px 12px"><span style="padding:2px 8px;border-radius:99px;font-size:10.5px;font-weight:700;white-space:nowrap;background:{{ o.st.bg }};color:{{ o.st.fg }}">{{ o.st.t }}</span></td></tr></sc-for></tbody>
      </table>
      <sc-if value="{{ ocEmpty }}"><div style="padding:24px;text-align:center;font-size:12.5px;color:#666464">Nenhuma ocorrência neste recorte.</div></sc-if>
    </div>
</sc-if>

<sc-if value="{{ v.quest }}">
    <div data-screen-label="Editor do questionário" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span style="font-size:12.5px;color:#666464;margin-right:4px;white-space:nowrap">Questionário da empresa:</span><sc-for list="{{ qe.emps }}" as="c"><button onClick="{{ c.go }}" style="border:1px solid {{ c.bd }};background:{{ c.bg }};color:{{ c.fg }};border-radius:99px;padding:6px 12px;font-size:12.5px;cursor:pointer">{{ c.l }}</button></sc-for></div>
    <div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:14px 16px;display:flex;gap:14px;flex-wrap:wrap;align-items:center">
      <div style="display:flex;flex-direction:column;gap:3px;min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-weight:700;font-size:15px">Questionário · {{ qe.emp }}</span><span style="padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700;white-space:nowrap;background:{{ qe.st.bg }};color:{{ qe.st.fg }}">{{ qe.st.t }}</span></div><span style="font-size:12.5px;color:#666464">{{ qe.pubInfo }} · link {{ qe.url }}</span></div>
      <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:flex-end">
        <select value="" onChange="{{ qe.copyFrom }}" style="height:36px;border:1px solid #D6D6D6;border-radius:8px;padding:0 8px;background:#fff;font-size:12.5px"><option value="">Copiar de outra empresa…</option><sc-for list="{{ qe.others }}" as="o"><option value="{{ o }}">{{ o }}</option></sc-for></select>
        <button onClick="{{ qe.preview }}" style="border:1px solid #1F1F1F;background:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:12.5px;font-weight:600;white-space:nowrap">Visualizar como cliente</button>
        <sc-if value="{{ qe.dirty }}"><button onClick="{{ qe.discard }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:12.5px;white-space:nowrap">Descartar alterações</button></sc-if>
        <button onClick="{{ qe.askPub }}" style="border:0;background:{{ qe.pubBg }};color:#fff;border-radius:8px;padding:9px 14px;cursor:pointer;font-size:12.5px;font-weight:700;white-space:nowrap">Publicar versão {{ qe.nextV }}</button>
      </div>
    </div>
    <div style="font-size:12px;color:#666464;line-height:1.5">As alterações ficam em rascunho até a publicação. Respostas já recebidas continuam ligadas à versão em que foram respondidas. As perguntas marcadas como base dos indicadores (NPS, qualidade, prazo, atendimento e identificação do cliente) podem ter o texto editado, mas não podem ser excluídas.</div>
    <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start">
      <div style="flex:1 1 440px;min-width:0;display:flex;flex-direction:column;gap:12px">
        <button onClick="{{ qe.selTextos }}" style="text-align:left;background:#fff;border:1.5px solid {{ qe.txBd }};border-radius:10px;padding:12px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px;white-space:normal"><span><span style="font-weight:700;font-size:13.5px">Textos da pesquisa</span><br><span style="font-size:12px;color:#666464">Boas-vindas, cabeçalho do formulário e agradecimento</span></span><span style="color:#929090">›</span></button>
        <sc-for list="{{ qe.secs }}" as="s" hint-placeholder-count="3">
          <div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;overflow:hidden">
            <div style="padding:10px 14px;border-bottom:1px solid #EFEFEF;display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-size:11.5px;font-weight:700;letter-spacing:.06em;color:#C70602">{{ s.l }}</span><span style="font-size:11.5px;color:#929090">{{ s.n }} pergunta(s)</span></div>
            <sc-for list="{{ s.items }}" as="it">
              <div onClick="{{ it.go }}" style="display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid #EFEFEF;cursor:pointer;background:{{ it.bg }};border-left:3px solid {{ it.bl }}">
                <span style="font-size:12px;font-weight:700;color:#929090;font-variant-numeric:tabular-nums">{{ it.n }}</span>
                <div style="min-width:0;display:flex;flex-direction:column;gap:4px"><span style="font-size:13px;line-height:1.4">{{ it.l }}</span><div style="display:flex;gap:4px;flex-wrap:wrap"><span style="background:#F4F4F4;border-radius:5px;padding:1px 7px;font-size:10.5px;font-weight:600;color:#545252;white-space:nowrap">{{ it.tipo }}</span><sc-for list="{{ it.chips }}" as="ch"><span style="border-radius:5px;padding:1px 7px;font-size:10.5px;font-weight:600;white-space:nowrap;background:{{ ch.bg }};color:{{ ch.fg }}">{{ ch.t }}</span></sc-for></div></div>
                <div onClick="{{ stop }}" style="display:flex;gap:2px;align-items:center"><button onClick="{{ it.up }}" disabled="{{ it.noUp }}" title="Subir" style="width:28px;height:28px;border:1px solid #E4E4E4;background:#fff;border-radius:6px;cursor:pointer;font-size:12px;opacity:{{ it.upOp }}">↑</button><button onClick="{{ it.down }}" disabled="{{ it.noDown }}" title="Descer" style="width:28px;height:28px;border:1px solid #E4E4E4;background:#fff;border-radius:6px;cursor:pointer;font-size:12px;opacity:{{ it.downOp }}">↓</button><button onClick="{{ it.dup }}" title="Duplicar" style="width:28px;height:28px;border:1px solid #E4E4E4;background:#fff;border-radius:6px;cursor:pointer;font-size:12px">⧉</button><sc-if value="{{ it.canDel }}"><button onClick="{{ it.del }}" title="Excluir" style="width:28px;height:28px;border:1px solid #E4E4E4;background:#fff;border-radius:6px;cursor:pointer;font-size:14px;color:#A80502">×</button></sc-if><sc-if value="{{ it.lock }}"><span title="Base dos indicadores" style="width:28px;height:28px;display:grid;place-items:center;font-size:12px;color:#929090">🔒</span></sc-if></div>
              </div>
            </sc-for>
            <div style="padding:10px 14px;display:flex;flex-direction:column;gap:8px">
              <button onClick="{{ s.add }}" style="align-self:flex-start;border:1px dashed #CFCFCF;background:none;border-radius:7px;padding:7px 12px;cursor:pointer;font-size:12.5px;color:#545252">+ Adicionar pergunta</button>
              <sc-if value="{{ s.addOpen }}"><div style="display:flex;gap:6px;flex-wrap:wrap"><sc-for list="{{ s.addOpts }}" as="o"><button onClick="{{ o.go }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:7px;padding:6px 11px;cursor:pointer;font-size:12px">{{ o.l }}</button></sc-for></div></sc-if>
            </div>
          </div>
        </sc-for>
      </div>
      <div style="flex:1 1 340px;min-width:0;position:sticky;top:16px;background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:12px">
        <sc-if value="{{ qe.isTextos }}">
          <div style="font-weight:700;font-size:14.5px">Textos da pesquisa</div>
          <div style="font-size:12px;color:#666464">Use [EMPRESA] para inserir o nome da empresa automaticamente.</div>
          <sc-for list="{{ qe.texts }}" as="t"><label style="display:flex;flex-direction:column;gap:5px;font-size:11.5px;font-weight:600;color:#545252">{{ t.l }}<sc-if value="{{ t.big }}"><textarea rows="3" value="{{ t.v }}" onChange="{{ t.on }}" style="border:1px solid #D6D6D6;border-radius:7px;padding:8px 10px;font-size:13px;font-weight:400;line-height:1.5;resize:vertical;background:#fff;color:#1F1F1F"></textarea></sc-if><sc-if value="{{ t.small }}"><input value="{{ t.v }}" onChange="{{ t.on }}" style="height:36px;border:1px solid #D6D6D6;border-radius:7px;padding:0 10px;font-size:13px;font-weight:400;background:#fff;color:#1F1F1F"></sc-if></label></sc-for>
        </sc-if>
        <sc-if value="{{ qe.isItem }}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-weight:700;font-size:14.5px">Pergunta {{ qi.n }}</span><sc-if value="{{ qi.base }}"><span style="background:#EEEEEE;color:#545252;border-radius:5px;padding:2px 8px;font-size:11px;font-weight:600">Base dos indicadores</span></sc-if></div>
          <label style="display:flex;flex-direction:column;gap:5px;font-size:11.5px;font-weight:600;color:#545252">Tipo<select value="{{ qi.kind }}" onChange="{{ qi.onKind }}" disabled="{{ qi.base }}" style="height:36px;border:1px solid #D6D6D6;border-radius:7px;padding:0 8px;background:#fff;font-size:13px;font-weight:400;color:#1F1F1F"><sc-for list="{{ qi.kinds }}" as="o"><option value="{{ o.v }}">{{ o.l }}</option></sc-for></select></label>
          <label style="display:flex;flex-direction:column;gap:5px;font-size:11.5px;font-weight:600;color:#545252">Enunciado<textarea rows="3" value="{{ qi.l }}" onChange="{{ qi.onL }}" style="border:1px solid #D6D6D6;border-radius:7px;padding:8px 10px;font-size:13px;font-weight:400;line-height:1.5;resize:vertical;background:#fff;color:#1F1F1F"></textarea></label>
          <label style="display:flex;flex-direction:column;gap:5px;font-size:11.5px;font-weight:600;color:#545252">Texto de apoio (opcional)<input value="{{ qi.help }}" onChange="{{ qi.onHelp }}" placeholder="Aparece abaixo do enunciado" style="height:36px;border:1px solid #D6D6D6;border-radius:7px;padding:0 10px;font-size:13px;font-weight:400;background:#fff;color:#1F1F1F"></label>
          <sc-if value="{{ qi.canSec }}"><label style="display:flex;flex-direction:column;gap:5px;font-size:11.5px;font-weight:600;color:#545252">Seção<select value="{{ qi.sec }}" onChange="{{ qi.onSec }}" style="height:36px;border:1px solid #D6D6D6;border-radius:7px;padding:0 8px;background:#fff;font-size:13px;font-weight:400;color:#1F1F1F"><sc-for list="{{ qi.secs }}" as="o"><option value="{{ o.v }}">{{ o.l }}</option></sc-for></select></label></sc-if>
          <button onClick="{{ qi.togReq }}" style="display:flex;align-items:center;gap:10px;border:0;background:none;padding:0;cursor:pointer;font-size:13px;text-align:left;opacity:{{ qi.reqOp }}"><span style="width:34px;height:19px;border-radius:99px;padding:2px;display:flex;flex:none;justify-content:{{ qi.rj }};background:{{ qi.rb }}"><span style="width:15px;height:15px;border-radius:50%;background:#fff"></span></span>Resposta obrigatória{{ qi.reqNote }}</button>
          <sc-if value="{{ qi.isEscala }}">
            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">
              <label style="display:flex;flex-direction:column;gap:5px;font-size:11.5px;font-weight:600;color:#545252">Rótulo da nota 0<input value="{{ qi.lo }}" onChange="{{ qi.onLo }}" style="height:36px;border:1px solid #D6D6D6;border-radius:7px;padding:0 10px;font-size:13px;font-weight:400;background:#fff;color:#1F1F1F"></label>
              <label style="display:flex;flex-direction:column;gap:5px;font-size:11.5px;font-weight:600;color:#545252">Rótulo da nota 10<input value="{{ qi.hi }}" onChange="{{ qi.onHi }}" style="height:36px;border:1px solid #D6D6D6;border-radius:7px;padding:0 10px;font-size:13px;font-weight:400;background:#fff;color:#1F1F1F"></label>
            </div>
            <div style="background:#FDF2F2;border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:8px">
              <sc-if value="{{ qi.flagFixed }}"><span style="font-size:12.5px;line-height:1.45">Sinaliza nota ≤ 6 automaticamente. Setor sugerido: <strong>{{ qi.setorFixed }}</strong> (regra do módulo).</span></sc-if>
              <sc-if value="{{ qi.canFlag }}">
                <button onClick="{{ qi.togFlag }}" style="display:flex;align-items:center;gap:10px;border:0;background:none;padding:0;cursor:pointer;font-size:13px;text-align:left"><span style="width:34px;height:19px;border-radius:99px;padding:2px;display:flex;flex:none;justify-content:{{ qi.fj }};background:{{ qi.fb }}"><span style="width:15px;height:15px;border-radius:50%;background:#fff"></span></span>Sinalizar nota ≤ 6 para análise do SAC</button>
                <sc-if value="{{ qi.flag }}"><label style="display:flex;flex-direction:column;gap:5px;font-size:11.5px;font-weight:600;color:#545252">Setor sugerido para nota baixa<select value="{{ qi.setor }}" onChange="{{ qi.onSetor }}" style="height:34px;border:1px solid #D6D6D6;border-radius:7px;padding:0 8px;background:#fff;font-size:13px;font-weight:400;color:#1F1F1F"><sc-for list="{{ setores }}" as="o"><option value="{{ o }}">{{ o }}</option></sc-for></select></label></sc-if>
              </sc-if>
            </div>
          </sc-if>
          <sc-if value="{{ qi.isOpts }}">
            <div style="display:flex;flex-direction:column;gap:6px"><span style="font-size:11.5px;font-weight:600;color:#545252">Opções</span>
              <sc-for list="{{ qi.opts }}" as="o"><div style="display:flex;gap:6px;align-items:center"><span style="width:14px;height:14px;border-radius:{{ qi.rad }};border:2px solid #929090;flex:none"></span><input value="{{ o.v }}" onChange="{{ o.on }}" style="flex:1;min-width:0;height:34px;border:1px solid #D6D6D6;border-radius:7px;padding:0 10px;font-size:13px;background:#fff"><button onClick="{{ o.del }}" title="Remover opção" style="width:30px;height:30px;border:0;background:none;color:#A80502;cursor:pointer;font-size:16px">×</button></div></sc-for>
              <button onClick="{{ qi.addOpt }}" style="align-self:flex-start;border:0;background:none;color:#A80502;cursor:pointer;font-size:12.5px;font-weight:600;padding:2px 0">+ Adicionar opção</button>
              <button onClick="{{ qi.togOutro }}" style="display:flex;align-items:center;gap:10px;border:0;background:none;padding:0;cursor:pointer;font-size:13px;text-align:left"><span style="width:34px;height:19px;border-radius:99px;padding:2px;display:flex;flex:none;justify-content:{{ qi.oj }};background:{{ qi.ob }}"><span style="width:15px;height:15px;border-radius:50%;background:#fff"></span></span>Incluir opção “Outro” com campo de texto</button>
            </div>
          </sc-if>
        </sc-if>
      </div>
    </div>
    <div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;overflow-x:auto">
      <div style="padding:12px 16px;border-bottom:1px solid #EFEFEF;font-weight:700;font-size:14px">Versões publicadas · {{ qe.emp }}</div>
      <table style="border-collapse:collapse;width:100%;min-width:680px;font-size:12.5px">
        <thead><tr style="background:#FAFAFA"><sc-for list="{{ qe.hCols }}" as="h"><th style="text-align:left;font-weight:600;font-size:11.5px;color:#666464;padding:9px 12px;border-bottom:1px solid #E4E4E4;white-space:nowrap">{{ h }}</th></sc-for></tr></thead>
        <tbody><sc-for list="{{ qe.hist }}" as="h"><tr style="border-bottom:1px solid #EFEFEF"><td style="padding:9px 12px;font-weight:700">v{{ h.v }}</td><td style="padding:9px 12px;white-space:nowrap">{{ h.at }}</td><td style="padding:9px 12px;white-space:nowrap">{{ h.by }}</td><td style="padding:9px 12px">{{ h.nota }}</td><td style="padding:9px 12px">{{ h.n }}</td><td style="padding:9px 12px">{{ h.resp }}</td></tr></sc-for></tbody>
      </table>
    </div>
</sc-if>

<sc-if value="{{ v.notifs }}">
    <div data-screen-label="Notificações" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span style="font-size:12.5px;color:#666464;margin-right:4px">Visualizar como setor:</span><sc-for list="{{ nChips }}" as="c"><button onClick="{{ c.go }}" style="border:1px solid {{ c.bd }};background:{{ c.bg }};color:{{ c.fg }};border-radius:99px;padding:6px 12px;font-size:12.5px;cursor:pointer">{{ c.l }} <span style="opacity:.7">{{ c.n }}</span></button></sc-for></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr));gap:12px">
      <sc-for list="{{ notifs }}" as="n" hint-placeholder-count="4">
        <div style="background:#fff;border:1px solid #E4E4E4;border-top:3px solid {{ n.tc }};border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;opacity:{{ n.op }}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-size:11px;font-weight:700;letter-spacing:.06em;color:#7A4C00;display:flex;align-items:center;gap:6px"><sc-if value="{{ n.unread }}"><span style="width:8px;height:8px;border-radius:50%;background:#C70602"></span></sc-if>NOVA OCORRÊNCIA DE PESQUISA</span><span style="font-size:11px;color:#929090">{{ n.at }}</span></div>
          <div style="display:grid;grid-template-columns:110px minmax(0,1fr);gap:5px 10px;font-size:12.5px"><sc-for list="{{ n.f }}" as="f"><span style="color:#666464">{{ f.l }}</span><span style="font-weight:{{ f.fw }};color:{{ f.c }}">{{ f.v }}</span></sc-for></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid #EFEFEF;padding-top:10px"><sc-if value="{{ n.unread }}"><button onClick="{{ n.read }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:12px">Marcar como lida</button></sc-if><button onClick="{{ n.open }}" style="border:0;background:#1F1F1F;color:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600">Abrir ocorrência {{ n.oc }}</button></div>
        </div>
      </sc-for>
    </div>
    <sc-if value="{{ nEmpty }}"><div style="background:#fff;border:1px dashed #CFCFCF;border-radius:10px;padding:28px;text-align:center;color:#666464;font-size:13px">Nenhuma notificação para este setor.</div></sc-if>
</sc-if>
  </main>
</div>
</sc-if>

<sc-if value="{{ dr.show }}">
<div style="position:fixed;inset:0;background:rgba(20,20,20,.45);z-index:60;display:flex;justify-content:flex-end" onClick="{{ closeDr }}">
  <div data-screen-label="Detalhes da pesquisa" onClick="{{ stop }}" style="width:min(780px,100%);height:100%;background:#F4F4F4;display:flex;flex-direction:column">
    <div style="background:#fff;padding:14px 20px;border-bottom:1px solid #E4E4E4;display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <div style="display:flex;flex-direction:column;gap:4px;min-width:0"><span style="font-size:11px;color:#929090;font-weight:600;letter-spacing:.06em">DETALHES DA PESQUISA</span><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-weight:700;font-size:18px;font-variant-numeric:tabular-nums">{{ dr.id }}</span><span style="padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700;white-space:nowrap;background:{{ dr.st.bg }};color:{{ dr.st.fg }}">{{ dr.st.t }}</span></div><span style="font-size:12.5px;color:#545252">{{ dr.emp }} · {{ dr.data }} · {{ dr.origem }}</span></div>
      <button onClick="{{ closeDr }}" style="border:0;background:none;cursor:pointer;font-size:24px;color:#666464;padding:0 4px;line-height:1">×</button>
    </div>
    <div style="flex:1;overflow:auto;padding:16px 20px;display:flex;flex-direction:column;gap:14px">
      <sc-if value="{{ dr.alert }}"><div data-screen-label="Nota baixa identificada" style="background:#FDECEC;border:1.5px solid #C70602;border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:6px"><span style="font-size:11px;font-weight:700;letter-spacing:.06em;color:#A80502">NOTA BAIXA IDENTIFICADA AUTOMATICAMENTE</span><span style="font-size:14px;font-weight:600;color:#7F0401">Esta avaliação recebeu uma nota igual ou inferior a 6.</span><span style="font-size:13px;color:#7F0401">É necessário avaliar se a situação requer tratamento.</span><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:2px"><sc-for list="{{ dr.lows }}" as="l"><span style="background:#fff;border-radius:6px;padding:4px 9px;font-size:12px;color:#A80502;font-weight:600">{{ l.l }}: {{ l.v }}</span></sc-for></div></div></sc-if>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px"><sc-for list="{{ dr.notas }}" as="n"><div style="background:{{ n.bg }};border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:2px"><span style="font-size:10.5px;font-weight:600;color:{{ n.fg }}">{{ n.l }}</span><span style="font-size:26px;font-weight:700;color:{{ n.fg }};font-variant-numeric:tabular-nums">{{ n.v }}</span></div></sc-for></div>

      <div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:14px 16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px 16px"><sc-for list="{{ dr.cli }}" as="f"><div><div style="font-size:10.5px;color:#929090;font-weight:600">{{ f.l }}</div><div style="font-size:13px;overflow-wrap:anywhere">{{ f.v }}</div></div></sc-for></div>
      <div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:8px"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px"><div><div style="font-size:10.5px;color:#929090;font-weight:600">CANAL</div><div style="font-size:13px;font-weight:600">{{ dr.canal }}</div></div><div><div style="font-size:10.5px;color:#929090;font-weight:600">MOTIVO DA COMPRA</div><div style="font-size:13px;font-weight:600">{{ dr.motivo }}</div></div></div><div style="font-size:10.5px;color:#929090;font-weight:600">COMENTÁRIO</div><div style="font-size:14px;line-height:1.55">{{ dr.coment }}</div><sc-if value="{{ dr.hasExtra }}"><div style="font-size:10.5px;color:#929090;font-weight:600;margin-top:6px">OUTRAS RESPOSTAS</div><sc-for list="{{ dr.extra }}" as="x"><div style="display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:10px;font-size:13px;border-top:1px solid #EFEFEF;padding-top:6px"><span style="color:#545252">{{ x.l }}</span><span style="font-weight:600">{{ x.v }}</span></div></sc-for></sc-if></div>

      <sc-if value="{{ dr.links }}"><div style="display:flex;gap:8px;flex-wrap:wrap">
        <sc-if value="{{ dr.hasOc }}"><button onClick="{{ dr.openOc }}" style="border:1.5px solid #D9A400;background:#FFFBEF;color:#7A4C00;border-radius:8px;padding:9px 14px;cursor:pointer;font-weight:700;font-size:12.5px">VER OCORRÊNCIA {{ dr.oc }}</button></sc-if>
        <sc-if value="{{ dr.hasMan }}"><button onClick="{{ dr.openMan }}" style="border:1.5px solid #C70602;background:#FFF8F8;color:#A80502;border-radius:8px;padding:9px 14px;cursor:pointer;font-weight:700;font-size:12.5px">VER MANIFESTAÇÃO {{ dr.man }}</button></sc-if>
      </div></sc-if>

      <sc-if value="{{ dr.canAct }}">
      <div data-screen-label="Análise da nota baixa" style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:14px">
        <div style="font-weight:700;font-size:14.5px">{{ dr.actTitle }}</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="font-size:11px;font-weight:700;letter-spacing:.06em;color:#666464">SETOR SUGERIDO</span><span style="background:#1F1F1F;color:#fff;border-radius:7px;padding:6px 12px;font-weight:700;font-size:12.5px;letter-spacing:.04em">{{ dec.setorUp }}</span><sc-if value="{{ dec.notAlt }}"><button onClick="{{ dec.alt }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:7px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600">ALTERAR SETOR</button></sc-if><sc-if value="{{ dec.isAlt }}"><select value="{{ dec.setor }}" onChange="{{ dec.onSetor }}" style="height:32px;border:1px solid #D6D6D6;border-radius:7px;padding:0 8px;background:#fff;font-size:12.5px"><sc-for list="{{ setores }}" as="o"><option value="{{ o }}">{{ o }}</option></sc-for></select></sc-if><span style="font-size:11.5px;color:#929090">{{ dec.why }}</span></div>
        <label style="display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:700;letter-spacing:.06em;color:#666464">JUSTIFICAR DECISÃO<textarea rows="2" value="{{ dec.just }}" onChange="{{ dec.onJust }}" placeholder="Obrigatória para “Não requer tratamento”. Opcional nas demais." style="border:1px solid {{ dec.jbc }};border-radius:8px;padding:9px 11px;font-size:13px;font-weight:400;letter-spacing:0;color:#1F1F1F;resize:vertical;background:#fff"></textarea></label>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px">
          <button onClick="{{ dec.toMan }}" style="border:0;background:#C70602;color:#fff;border-radius:9px;padding:12px;cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:3px;white-space:normal"><span style="font-weight:700;font-size:12.5px;letter-spacing:.04em">TRANSFORMAR EM MANIFESTAÇÃO</span><span style="font-size:11.5px;color:#FFE1E0">Abre manifestação formal vinculada</span></button>
          <button onClick="{{ dec.toOc }}" style="border:1.5px solid #D9A400;background:#FFFBEF;color:#5E3B00;border-radius:9px;padding:12px;cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:3px;white-space:normal"><span style="font-weight:700;font-size:12.5px;letter-spacing:.04em">GERAR OCORRÊNCIA</span><span style="font-size:11.5px">Sinaliza o setor, sem reclamação formal</span></button>
          <button onClick="{{ dec.noTrat }}" style="border:1.5px solid #D6D6D6;background:#fff;color:#3A3939;border-radius:9px;padding:12px;cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:3px;white-space:normal"><span style="font-weight:700;font-size:12.5px;letter-spacing:.04em">NÃO REQUER TRATAMENTO</span><span style="font-size:11.5px;color:#666464">Exige justificativa</span></button>
        </div>
        <sc-if value="{{ dec.showOc }}">
          <div data-screen-label="Ocorrência de pesquisa" style="border:1.5px solid #D9A400;background:#FFFBEF;border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:10px">
            <div style="font-size:11px;font-weight:700;letter-spacing:.06em;color:#7A4C00">NOVA OCORRÊNCIA DE PESQUISA · não é manifestação formal</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px">
              <label style="display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:600;color:#545252">Pergunta avaliada<select value="{{ dec.perg }}" onChange="{{ dec.onPerg }}" style="height:34px;border:1px solid #D6D6D6;border-radius:7px;padding:0 6px;background:#fff;font-size:12.5px;font-weight:400"><sc-for list="{{ dec.pergO }}" as="o"><option value="{{ o }}">{{ o }}</option></sc-for></select></label>
              <label style="display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:600;color:#545252">Responsável<select value="{{ dec.resp }}" onChange="{{ dec.onResp }}" style="height:34px;border:1px solid #D6D6D6;border-radius:7px;padding:0 6px;background:#fff;font-size:12.5px;font-weight:400"><sc-for list="{{ dec.respO }}" as="o"><option value="{{ o }}">{{ o }}</option></sc-for></select></label>
              <label style="display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:600;color:#545252">Prazo<input type="date" value="{{ dec.prazo }}" onChange="{{ dec.onPrazo }}" style="height:34px;border:1px solid #D6D6D6;border-radius:7px;padding:0 6px;background:#fff;font-size:12.5px;font-weight:400"></label>
            </div>
            <label style="display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:600;color:#545252">Observação para o setor<textarea rows="2" value="{{ dec.obs }}" onChange="{{ dec.onObs }}" style="border:1px solid #D6D6D6;border-radius:7px;padding:8px 10px;font-size:13px;font-weight:400;background:#fff;resize:vertical"></textarea></label>
            <button onClick="{{ dec.togNotify }}" style="display:flex;align-items:center;gap:10px;border:0;background:none;padding:0;cursor:pointer;font-size:13px;text-align:left"><span style="width:34px;height:19px;border-radius:99px;padding:2px;display:flex;flex:none;justify-content:{{ dec.nj }};background:{{ dec.nb }}"><span style="width:15px;height:15px;border-radius:50%;background:#fff"></span></span>Notificar o setor agora</button>
            <div style="display:flex;justify-content:flex-end;gap:8px"><button onClick="{{ dec.cancelOc }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:7px;padding:8px 14px;cursor:pointer;font-size:12.5px">Cancelar</button><button onClick="{{ dec.createOc }}" style="border:0;background:#7A4C00;color:#fff;border-radius:7px;padding:8px 14px;cursor:pointer;font-size:12.5px;font-weight:700">{{ dec.createL }}</button></div>
          </div>
        </sc-if>
      </div>
      </sc-if>
      <sc-if value="{{ dr.canClose }}"><div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><span style="font-size:13px;color:#545252">Sem notas ≤ 6. Nenhuma ação obrigatória.</span><div style="display:flex;gap:8px"><button onClick="{{ dr.analyze }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:7px;padding:8px 12px;cursor:pointer;font-size:12.5px">Analisar mesmo assim</button><button onClick="{{ dr.close }}" style="border:0;background:#1F1F1F;color:#fff;border-radius:7px;padding:8px 14px;cursor:pointer;font-size:12.5px;font-weight:600">Encerrar pesquisa</button></div></div></sc-if>

      <div data-screen-label="Histórico" style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:0">
        <div style="font-weight:700;font-size:14px;margin-bottom:10px">Histórico e rastreabilidade</div>
        <sc-for list="{{ dr.hist }}" as="h"><div style="display:grid;grid-template-columns:14px minmax(0,1fr);gap:12px"><div style="display:flex;flex-direction:column;align-items:center"><span style="width:10px;height:10px;border-radius:50%;background:{{ h.c }};margin-top:4px;flex:none"></span><span style="flex:1;width:2px;background:#EFEFEF"></span></div><div style="padding-bottom:12px"><div style="font-size:11.5px;color:#929090;font-variant-numeric:tabular-nums">{{ h.at }}</div><div style="font-size:13px;line-height:1.45">{{ h.t }}</div></div></div></sc-for>
      </div>
    </div>
  </div>
</div>
</sc-if>

<sc-if value="{{ od.show }}">
<div style="position:fixed;inset:0;background:rgba(20,20,20,.45);z-index:62;display:flex;justify-content:flex-end" onClick="{{ closeOd }}">
  <div data-screen-label="Detalhes da ocorrência" onClick="{{ stop }}" style="width:min(680px,100%);height:100%;background:#F4F4F4;display:flex;flex-direction:column">
    <div style="background:#FFFBEF;padding:14px 20px;border-bottom:1.5px solid #D9A400;display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <div style="display:flex;flex-direction:column;gap:4px"><span style="font-size:11px;font-weight:700;letter-spacing:.06em;color:#7A4C00">OCORRÊNCIA DE PESQUISA · não é manifestação formal</span><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-weight:700;font-size:18px">{{ od.id }}</span><span style="padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700;background:{{ od.st.bg }};color:{{ od.st.fg }}">{{ od.st.t }}</span></div></div>
      <button onClick="{{ closeOd }}" style="border:0;background:none;cursor:pointer;font-size:24px;color:#666464;padding:0 4px;line-height:1">×</button>
    </div>
    <div style="flex:1;overflow:auto;padding:16px 20px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;font-size:11.5px"><sc-for list="{{ od.steps }}" as="s"><span style="display:flex;gap:4px;align-items:center"><span style="padding:4px 9px;border-radius:6px;font-weight:600;background:{{ s.bg }};color:{{ s.fg }};white-space:nowrap">{{ s.l }}</span>{{ s.a }}</span></sc-for></div>
      <div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:14px 16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px 16px"><sc-for list="{{ od.f }}" as="f"><div><div style="font-size:10.5px;color:#929090;font-weight:600">{{ f.l }}</div><div style="font-size:13px;font-weight:{{ f.fw }};color:{{ f.c }}">{{ f.v }}</div></div></sc-for></div>
      <div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:6px"><span style="font-size:10.5px;color:#929090;font-weight:600">COMENTÁRIO DO CLIENTE</span><span style="font-size:14px;line-height:1.55">{{ od.coment }}</span><span style="font-size:10.5px;color:#929090;font-weight:600;margin-top:6px">OBSERVAÇÃO DO SAC</span><span style="font-size:13px;line-height:1.5">{{ od.obs }}</span></div>
      <div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:10px">
        <span style="font-size:11px;font-weight:700;letter-spacing:.06em;color:#666464">TRATATIVA DO SETOR · {{ od.setorUp }}</span>
        <textarea rows="3" value="{{ od.trat }}" onChange="{{ od.onTrat }}" disabled="{{ od.tratDis }}" placeholder="O que o setor verificou e fez a partir da sinalização" style="border:1px solid {{ od.tbc }};border-radius:8px;padding:9px 11px;font-size:13px;line-height:1.5;resize:vertical;background:#fff"></textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button onClick="{{ od.verP }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:7px;padding:8px 12px;cursor:pointer;font-size:12.5px">Ver pesquisa {{ od.pesq }}</button>
          <sc-if value="{{ od.canFwd }}"><button onClick="{{ od.fwd }}" style="border:0;background:#7A4C00;color:#fff;border-radius:7px;padding:8px 14px;cursor:pointer;font-size:12.5px;font-weight:700">Encaminhar ao setor</button></sc-if>
          <sc-if value="{{ od.canStart }}"><button onClick="{{ od.start }}" style="border:0;background:#1F1F1F;color:#fff;border-radius:7px;padding:8px 14px;cursor:pointer;font-size:12.5px;font-weight:700">Iniciar tratamento</button></sc-if>
          <sc-if value="{{ od.canEnd }}"><button onClick="{{ od.end }}" style="border:0;background:#1E6B3A;color:#fff;border-radius:7px;padding:8px 14px;cursor:pointer;font-size:12.5px;font-weight:700">Registrar tratativa e encerrar</button></sc-if>
        </div>
      </div>
      <div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:14px 16px">
        <div style="font-weight:700;font-size:14px;margin-bottom:10px">Histórico da ocorrência</div>
        <sc-for list="{{ od.hist }}" as="h"><div style="display:grid;grid-template-columns:14px minmax(0,1fr);gap:12px"><div style="display:flex;flex-direction:column;align-items:center"><span style="width:10px;height:10px;border-radius:50%;background:#D9A400;margin-top:4px;flex:none"></span><span style="flex:1;width:2px;background:#EFEFEF"></span></div><div style="padding-bottom:12px"><div style="font-size:11.5px;color:#929090">{{ h.at }}</div><div style="font-size:13px;line-height:1.45">{{ h.t }}</div></div></div></sc-for>
      </div>
    </div>
  </div>
</div>
</sc-if>

<sc-if value="{{ md.conf }}">
<div style="position:fixed;inset:0;background:rgba(20,20,20,.5);z-index:70;display:grid;place-items:center;padding:20px">
  <div data-screen-label="Transformação em manifestação" style="width:min(540px,100%);background:#fff;border-radius:12px;overflow:hidden">
    <div style="background:#C70602;color:#fff;padding:16px 20px"><div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#FFE1E0">MANIFESTAÇÃO FORMAL</div><div style="font-size:17px;font-weight:700">Transformar {{ md.pesq }} em manifestação?</div></div>
    <div style="padding:16px 20px;display:flex;flex-direction:column;gap:10px;font-size:13px;line-height:1.5">
      <span>Será criada uma nova manifestação no fluxo do SAC. A pesquisa original é mantida e as duas ficam vinculadas.</span>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px"><sc-for list="{{ md.copy }}" as="c"><span style="background:#F4F4F4;border-radius:6px;padding:6px 9px;font-size:12px">✓ {{ c }}</span></sc-for></div>
    </div>
    <div style="padding:12px 20px 18px;display:flex;justify-content:flex-end;gap:8px"><button onClick="{{ closeMd }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:8px;padding:9px 16px;cursor:pointer;font-size:13px">Cancelar</button><button onClick="{{ md.ok }}" style="border:0;background:#C70602;color:#fff;border-radius:8px;padding:9px 18px;cursor:pointer;font-size:13px;font-weight:700">Criar manifestação</button></div>
  </div>
</div>
</sc-if>

<sc-if value="{{ mv.show }}">
<div style="position:fixed;inset:0;background:rgba(20,20,20,.5);z-index:70;display:grid;place-items:center;padding:20px">
  <div style="width:min(600px,100%);max-height:100%;overflow:auto;background:#fff;border-radius:12px">
    <div style="padding:16px 20px;border-bottom:2px solid #C70602;display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#A80502">MANIFESTAÇÃO FORMAL</div><div style="display:flex;gap:8px;align-items:center"><span style="font-weight:700;font-size:19px">{{ mv.id }}</span><span style="padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700;background:#EEEEEE;color:#545252">Registrada · aguardando análise do SAC</span></div></div><button onClick="{{ closeMd }}" style="border:0;background:none;cursor:pointer;font-size:24px;color:#666464;padding:0 4px;line-height:1">×</button></div>
    <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;background:#FFF8F8;border:1px solid #F3CFCF;border-radius:9px;padding:12px"><div><div style="font-size:10.5px;font-weight:700;color:#A80502;letter-spacing:.05em">ORIGEM</div><div style="font-weight:700">PESQUISA DE SATISFAÇÃO</div></div><div><div style="font-size:10.5px;font-weight:700;color:#A80502;letter-spacing:.05em">ID DA PESQUISA</div><div style="font-weight:700">{{ mv.pesq }}</div></div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px 14px"><sc-for list="{{ mv.f }}" as="f"><div><div style="font-size:10.5px;color:#929090;font-weight:600">{{ f.l }}</div><div style="font-size:13px">{{ f.v }}</div></div></sc-for></div>
      <div><div style="font-size:10.5px;color:#929090;font-weight:600">DESCRIÇÃO (copiada do comentário)</div><div style="font-size:13.5px;line-height:1.55">{{ mv.coment }}</div></div>
    </div>
    <div style="padding:12px 20px 18px;display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap"><a href="AssistenteSAC.dc.html" style="border:1px solid #D6D6D6;background:#fff;border-radius:8px;padding:9px 14px;font-size:13px;color:#1F1F1F">Abrir no Assistente SAC</a><button onClick="{{ mv.back }}" style="border:0;background:#1F1F1F;color:#fff;border-radius:8px;padding:9px 16px;cursor:pointer;font-size:13px;font-weight:700">VER PESQUISA ORIGINAL</button></div>
  </div>
</div>
</sc-if>

<sc-if value="{{ md.pub }}">
<div style="position:fixed;inset:0;background:rgba(20,20,20,.5);z-index:70;display:grid;place-items:center;padding:20px">
  <div style="width:min(520px,100%);background:#fff;border-radius:12px;padding:20px 22px;display:flex;flex-direction:column;gap:12px">
    <div style="font-weight:700;font-size:17px">Publicar questionário {{ qe.emp }} · {{ qe.nextV }}</div>
    <div style="font-size:13px;line-height:1.55;color:#3A3939">A nova versão passa a valer imediatamente no link {{ qe.url }}. Respostas anteriores continuam ligadas à versão em que foram respondidas.</div>
    <textarea rows="3" value="{{ pubNote }}" onChange="{{ onPubNote }}" placeholder="O que mudou nesta versão? (obrigatório)" style="border:1px solid #D6D6D6;border-radius:8px;padding:10px 12px;font-size:13.5px;resize:vertical;background:#fff"></textarea>
    <div style="display:flex;justify-content:flex-end;gap:8px"><button onClick="{{ closeMd }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:8px;padding:9px 16px;cursor:pointer;font-size:13px">Cancelar</button><button onClick="{{ doPublish }}" style="border:0;background:#C70602;color:#fff;border-radius:8px;padding:9px 18px;cursor:pointer;font-size:13px;font-weight:700">Publicar</button></div>
  </div>
</div>
</sc-if>

<sc-if value="{{ md.links }}">
<div style="position:fixed;inset:0;background:rgba(20,20,20,.5);z-index:70;display:grid;place-items:center;padding:20px">
  <div style="width:min(620px,100%);background:#fff;border-radius:12px;overflow:hidden">
    <div style="padding:16px 20px;border-bottom:1px solid #E4E4E4;display:flex;justify-content:space-between;align-items:center"><div><div style="font-weight:700;font-size:16px">Links das pesquisas públicas</div><div style="font-size:12px;color:#666464">Um formulário por empresa. A empresa é identificada pelo link.</div></div><button onClick="{{ closeMd }}" style="border:0;background:none;cursor:pointer;font-size:24px;color:#666464;padding:0 4px;line-height:1">×</button></div>
    <div style="padding:8px 20px 16px;display:flex;flex-direction:column">
      <sc-for list="{{ linkRows }}" as="l"><div style="display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid #EFEFEF;flex-wrap:wrap"><span style="font-weight:700;min-width:96px">{{ l.l }}</span><span style="flex:1;min-width:200px;font-family:ui-monospace,monospace;font-size:12px;color:#545252;overflow-wrap:anywhere">{{ l.url }}</span><button onClick="{{ l.copy }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px">Copiar</button><button onClick="{{ l.open }}" style="border:0;background:#C70602;color:#fff;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px;font-weight:600">Abrir</button></div></sc-for>
      <div style="font-size:12px;color:#666464;line-height:1.5;padding-top:10px">Links individuais (<span style="font-family:ui-monospace,monospace">/pesquisa/chiacchio/8f72k9</span>) já são aceitos e poderão vincular cliente, campanha, pedido ou manifestação. O cliente continua vendo apenas o formulário.</div>
    </div>
  </div>
</div>
</sc-if>

<sc-if value="{{ toast }}"><div style="position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#1F1F1F;color:#fff;padding:11px 16px;border-radius:8px;font-size:13px;z-index:90;max-width:92vw;box-shadow:0 8px 24px rgba(0,0,0,.2)">{{ toast }}</div></sc-if>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props="{&quot;modoInicial&quot;:{&quot;editor&quot;:&quot;enum&quot;,&quot;options&quot;:[&quot;Área pública&quot;,&quot;Área interna&quot;],&quot;default&quot;:&quot;Área pública&quot;,&quot;tsType&quot;:&quot;string&quot;},&quot;empresaPublica&quot;:{&quot;editor&quot;:&quot;enum&quot;,&quot;options&quot;:[&quot;Chiacchio&quot;,&quot;Plaschio&quot;,&quot;Tubahia&quot;],&quot;default&quot;:&quot;Chiacchio&quot;,&quot;tsType&quot;:&quot;string&quot;}}">
class Component extends DCLogic {
  state = { db: null, mode: null, pubEmp: null, token: false, form: {}, errs: {}, sent: null, closed: false, tab: 'geral', f: null, tr: { ano: 2026, mes: 10, emp: 'Chiacchio', openY: 2026, openM: '2026-10' }, sel: null, ocSel: null, mvId: null, modal: null, dec: {}, toast: '', loading: false, limit: 40, cf: 'Todos', cLimit: 20, dEmp: 'Todas', dPer: '12m', nSet: 'Todos', trat: '', submitting: false };

  F0() { return { emp: 'Todas', ano: '2026', mes: 'Todos', de: '', ate: '', cli: '', nota: 'Todas', canal: 'Todos', setor: 'Todos', status: 'Todos', origem: 'Todas' }; }
  K() {
    return {
      EMP: ['Chiacchio', 'Plaschio', 'Tubahia'], SLUG: { chiacchio: 'Chiacchio', plaschio: 'Plaschio', tubahia: 'Tubahia' },
      MN: ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'],
      MS: ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
      MONTHS: [[2025, 11], [2025, 12], [2026, 1], [2026, 2], [2026, 3], [2026, 4], [2026, 5], [2026, 6], [2026, 7], [2026, 8], [2026, 9], [2026, 10]],
      Q: [['nps', 'Recomendação (NPS)'], ['q', 'Qualidade dos produtos'], ['p', 'Prazo de entrega'], ['a', 'Atendimento']],
      SET: { q: 'Qualidade', p: 'Logística', a: 'Comercial / Atendimento', nps: 'SAC' },
      SETORES: ['Qualidade', 'Logística', 'Comercial / Atendimento', 'SAC', 'Financeiro', 'Expedição'],
      RESP: { 'Qualidade': ['Diego Alves', '[Nome]'], 'Logística': ['Rafael Souza', '[Nome]'], 'Comercial / Atendimento': ['Camila Torres', '[Nome]'], 'SAC': ['Luiza Martins'], 'Financeiro': ['Paula Ramos'], 'Expedição': ['Marcos Lima'] },
      CANAIS: ['WhatsApp', 'E-mail', 'Panfleto físico', 'Ligação'],
      MOTIVOS: ['Qualidade', 'Preço', 'Atendimento', 'Reputação da empresa', 'Custo-benefício', 'Outro'],
      STATUS: ['RECEBIDA', 'EM ANÁLISE', 'OCORRÊNCIA GERADA', 'ENCAMINHADA AO SETOR', 'EM TRATAMENTO', 'TRANSFORMADA EM MANIFESTAÇÃO', 'NÃO REQUER TRATAMENTO', 'ENCERRADA'],
      STC: { 'RECEBIDA': ['#EEEEEE', '#3A3939'], 'EM ANÁLISE': ['#E6EEF8', '#24508F'], 'OCORRÊNCIA GERADA': ['#FBF0D9', '#7A4C00'], 'ENCAMINHADA AO SETOR': ['#FBF0D9', '#7A4C00'], 'EM TRATAMENTO': ['#FBF0D9', '#7A4C00'], 'TRANSFORMADA EM MANIFESTAÇÃO': ['#FDECEC', '#A80502'], 'NÃO REQUER TRATAMENTO': ['#F4F4F4', '#666464'], 'ENCERRADA': ['#E6F2EA', '#1E6B3A'] },
      OCST: { 'Gerada · não encaminhada': ['#EEEEEE', '#545252'], 'Pendente de análise': ['#FBF0D9', '#7A4C00'], 'Em tratamento': ['#E6EEF8', '#24508F'], 'Encerrada': ['#E6F2EA', '#1E6B3A'] }
    };
  }

  componentDidMount() {
    let db = null;
    try { db = JSON.parse(localStorage.getItem('gc-pesquisas-v3') || 'null'); } catch (e) { }
    db = db || this.seed();
    if (!db.qz) { db.qz = this.buildQz(); db.surveys.forEach(s => { if (!s.qv) s.qv = 1; }); }
    this.setState({ db, f: this.F0(), loading: true });
    this._l = setTimeout(() => this.setState({ loading: false }), 500);
  }
  save(db) { try { localStorage.setItem('gc-pesquisas-v3', JSON.stringify(db)); } catch (e) { } }
  mut(fn) { const db = JSON.parse(JSON.stringify(this.state.db)); fn(db); this.setState({ db }); this.save(db); return db; }
  flash(t) { this.setState({ toast: t }); clearTimeout(this._t); this._t = setTimeout(() => this.setState({ toast: '' }), 2800); }
  now() { const d = new Date(), p = n => String(n).padStart(2, '0'); return '02/10/2026 ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  isLow(s) { return [s.nps, s.q, s.p, s.a].some(v => v <= 6) || (s.xl || []).some(x => x.v <= 6); }
  lows(s) { return this.K().Q.filter(([k]) => s[k] <= 6).map(([k, l]) => ({ k, l, v: s[k] })).concat((s.xl || []).filter(x => x.v <= 6).map(x => ({ k: 'x', l: x.l, v: x.v, setor: x.setor }))); }
  sug(s) { const K = this.K(); const c = [['q', s.q], ['p', s.p], ['a', s.a]].filter(x => x[1] <= 6).map(x => [K.SET[x[0]], x[1]]).concat((s.xl || []).filter(x => x.v <= 6).map(x => [x.setor || 'SAC', x.v])).sort((a, b) => a[1] - b[1]); return c.length ? c[0][0] : (s.nps <= 6 ? 'SAC' : '—'); }
  defQz() {
    const I = (id, kind, sec, l, o) => Object.assign({ id, key: id, kind, sec, l, req: true, base: true, del: false, help: '', lo: 'Péssimo', hi: 'Excelente', opts: null, outro: false, flag: false, setor: 'SAC' }, o || {});
    return { texts: { wT: 'Olá! Que bom ter você aqui.', wX: 'Sua opinião é muito importante para que a [EMPRESA] continue evoluindo. Queremos saber como foi a sua experiência com nossos produtos, prazos e atendimento.', hT: 'Avalie sua experiência com a [EMPRESA]', h1: 'Sua opinião é muito importante para que possamos continuar evoluindo!', h2: 'Responder esta pesquisa leva menos de 1 minuto e nos ajuda a melhorar nossos produtos, prazos e atendimento.', tT: 'Obrigado por avaliar a [EMPRESA]!', tX: 'Sua opinião foi registrada com sucesso.\nEla nos ajuda a melhorar continuamente nossos produtos, prazos e atendimento.' },
      items: [I('email', 'campo', 'dados', 'E-mail'), I('razao', 'campo', 'dados', 'Razão Social ou Nome Fantasia'), I('tel', 'campo', 'dados', 'Telefone para contato', { del: true }), I('cnpj', 'campo', 'dados', 'CNPJ'), I('cep', 'campo', 'dados', 'CEP', { del: true }),
        I('nps', 'escala', 'aval', 'Em uma escala de 0 a 10, qual a probabilidade de você recomendar a [EMPRESA] a um amigo ou colega?', { lo: 'Nada provável', hi: 'Extremamente provável' }), I('q', 'escala', 'aval', 'Em uma escala de 0 a 10, como você avalia a qualidade dos nossos produtos?'), I('p', 'escala', 'aval', 'Em uma escala de 0 a 10, como você avalia o nosso prazo de entrega?'), I('a', 'escala', 'aval', 'Em uma escala de 0 a 10, como você avalia o nosso atendimento?'),
        I('canal', 'escolha', 'compra', 'Por onde você recebeu esta pesquisa?', { del: true, opts: ['WhatsApp', 'E-mail', 'Panfleto físico', 'Ligação'] }), I('motivo', 'escolha', 'compra', 'Qual foi o principal motivo que levou você a comprar conosco?', { del: true, opts: ['Qualidade', 'Preço', 'Atendimento', 'Reputação da empresa', 'Custo-benefício'], outro: true }), I('coment', 'longo', 'compra', 'Gostaria de deixar algum comentário, dúvida ou sugestão?', { req: false, del: true })] };
  }
  buildQz() { const o = {}; this.K().EMP.forEach(e => { const d = this.defQz(); o[e] = { v: 1, at: '01/06/2026 09:00', by: 'Luiza Martins', pub: d, draft: JSON.parse(JSON.stringify(d)), hist: [{ v: 1, at: '01/06/2026 09:00', by: 'Luiza Martins', nota: 'Versão inicial, migrada do formulário atual', n: d.items.length }] }; }); return o; }
  iso(s) { return s.ano + '-' + String(s.mes).padStart(2, '0') + '-' + String(s.dia).padStart(2, '0'); }
  dt(s) { return String(s.dia).padStart(2, '0') + '/' + String(s.mes).padStart(2, '0') + '/' + s.ano + ' ' + s.hora; }

  seed() {
    const K = this.K(); let sd = 11; const rnd = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    const pick = a => a[Math.floor(rnd() * a.length)]; const cl = v => Math.max(0, Math.min(10, Math.round(v)));
    const CLI = [['Empresa Exemplo Ltda.', 'Exemplo Embalagens'], ['Comércio Modelo S.A.', 'Modelo Atacado'], ['Indústria Teste Ltda.', 'Teste Alimentos'], ['Mercado Exemplo ME', 'Mercadinho Exemplo'], ['Distribuidora Alfa Ltda.', 'Alfa Distribuição'], ['Padaria Bom Grão ME', 'Bom Grão'], ['Frigorífico Serra Ltda.', 'Serra Carnes'], ['Supermercado Central Ltda.', 'Central'], ['Laticínios Vale Verde Ltda.', 'Vale Verde'], ['Hortifruti Sol ME', 'Hortifruti Sol'], ['Cooperativa Agro Norte', 'Agro Norte'], ['Confeitaria Doce Lar ME', 'Doce Lar']];
    const COM = { p: ['Meu último pedido chegou depois do prazo.', 'A entrega atrasou três dias e não fomos avisados.', 'Prazo de entrega maior que o combinado com o vendedor.'], q: ['Algumas caixas vieram com a cola soltando.', 'A gramatura das bandejas variou entre lotes.', 'Recebemos parte do lote com impressão borrada.'], a: ['Demorei para conseguir retorno do atendimento.', 'O vendedor não respondeu às mensagens da semana.', 'Faltou clareza sobre a negociação do frete.'], nps: ['Bom produto, mas o preço subiu bastante.', 'Ainda comparando com outros fornecedores.'] };
    const POS = ['Atendimento muito rápido, parabéns à equipe.', 'Produto de ótima qualidade, sempre dentro do prazo.', 'Parceria de anos, seguimos satisfeitos.', 'Gostaria de receber o catálogo atualizado.', '', '', '', ''];
    const surveys = [], sent = {}, ocs = [], mans = [], notifs = []; let ocN = 1, manN = 100;
    const cliData = {}; CLI.forEach((c, i) => { cliData[c[0]] = { cnpj: String(10 + i * 7).padStart(2, '0') + '.' + String(100 + i * 37).slice(-3) + '.' + String(200 + i * 53).slice(-3) + '/0001-' + String(10 + i * 3).slice(-2), email: 'compras@' + c[1].toLowerCase().normalize('NFD').replace(/[^a-z]/g, '') + '.com.br', tel: '(77) 9' + String(8100 + i * 13) + '-' + String(1000 + i * 71).slice(-4), cep: '45.0' + String(10 + i).slice(-2) + '-' + String(100 + i * 9).slice(-3) }; });
    K.MONTHS.forEach(([ano, mes], mi) => K.EMP.forEach(emp => {
      const cur = ano === 2026 && mes === 10; const n = cur ? 3 + Math.floor(rnd() * 2) : 7 + Math.floor(rnd() * 7);
      sent[emp + '|' + ano + '|' + mes] = cur ? n * 3 : Math.round(n * (2.1 + rnd() * 1.1));
      for (let i = 0; i < n; i++) {
        const base = (emp === 'Chiacchio' ? 8.2 : emp === 'Plaschio' ? 7.8 : 8.0) + mi * 0.03;
        const q = cl(base + 0.3 + (rnd() - 0.5) * 4.4), p = cl(base - 0.7 + (rnd() - 0.5) * 5), a = cl(base + 0.5 + (rnd() - 0.5) * 4);
        const nps = cl((q + p + a) / 3 + 0.4 + (rnd() - 0.5) * 2.4);
        const c = pick(CLI), cd = cliData[c[0]];
        const s = { emp, ano, mes, dia: cur ? 1 + Math.floor(rnd() * 2) : 1 + Math.floor(rnd() * 28), hora: String(8 + Math.floor(rnd() * 10)).padStart(2, '0') + ':' + String(Math.floor(rnd() * 60)).padStart(2, '0'), razao: c[0], fantasia: c[1], cnpj: cd.cnpj, email: cd.email, tel: cd.tel, cep: cd.cep, canal: pick(['WhatsApp', 'WhatsApp', 'E-mail', 'E-mail', 'Panfleto físico', 'Ligação']), nps, q, p, a, motivo: pick(K.MOTIVOS.slice(0, 5)), coment: '', origem: rnd() < 0.3 ? 'Link individual' : 'Link geral', status: 'RECEBIDA', hist: [], oc: null, man: null, just: '' };
        const low = this.isLow(s);
        if (low) { const lw = [['q', q], ['p', p], ['a', a], ['nps', nps]].sort((x, y) => x[1] - y[1])[0][0]; s.coment = rnd() < 0.8 ? pick(COM[lw]) : ''; } else s.coment = pick(POS);
        surveys.push(s);
      }
    }));
    surveys.sort((x, y) => (this.iso(x) + x.hora).localeCompare(this.iso(y) + y.hora));
    const seq = { 2025: 0, 2026: 0 };
    surveys.forEach(s => {
      s.id = 'PESQ-' + s.ano + '-' + String(++seq[s.ano]).padStart(6, '0');
      const d = this.dt(s), dd = d.slice(0, 10), cur = s.ano === 2026 && s.mes === 10, low = this.isLow(s);
      s.hist.push({ at: d, t: 'Pesquisa recebida pelo ' + (s.origem === 'Link individual' ? 'link individual' : 'link /pesquisa/' + s.emp.toLowerCase()) });
      if (low) s.hist.push({ at: d, t: 'Nota ≤ 6 identificada automaticamente' });
      if (!low) { if (!cur) { s.status = 'ENCERRADA'; s.hist.push({ at: dd + ' 17:30', t: 'SAC encerrou a pesquisa · sem notas ≤ 6' }); } return; }
      if (cur) { s.status = 'RECEBIDA'; return; }
      const r = rnd(), setor = this.sug(s), lw = this.lows(s).sort((a, b) => a.v - b.v)[0], recent = s.ano === 2026 && s.mes === 9;
      s.hist.push({ at: dd + ' 10:05', t: 'SAC iniciou a análise' });
      if (r < 0.42) {
        const id = 'OCP-' + s.ano + '-' + String(ocN++).padStart(4, '0'); const resp = (K.RESP[setor] || ['[Nome]'])[0];
        const st = recent && rnd() < 0.6 ? (rnd() < 0.5 ? 'Pendente de análise' : 'Em tratamento') : 'Encerrada';
        const oh = [{ at: dd + ' 10:12', t: 'Ocorrência criada a partir de ' + s.id + ' por Luiza Martins (SAC)' }, { at: dd + ' 10:12', t: 'Notificação enviada ao setor ' + setor }];
        if (st !== 'Pendente de análise') oh.push({ at: dd + ' 14:00', t: setor + ' iniciou o tratamento' });
        if (st === 'Encerrada') oh.push({ at: dd + ' 16:40', t: setor + ' registrou tratativa' }, { at: dd + ' 16:40', t: 'Ocorrência encerrada' });
        ocs.push({ id, pesq: s.id, emp: s.emp, cli: s.razao, data: dd, nota: lw.v, perg: lw.l, coment: s.coment || '—', setor, resp, prazo: dd, status: st, trat: st === 'Encerrada' ? 'Verificado o caso com a equipe e ajustado o processo apontado pelo cliente.' : '', obs: 'Avaliar a nota baixa em ' + lw.l.toLowerCase() + '.', hist: oh });
        s.oc = id; s.hist.push({ at: dd + ' 10:12', t: 'SAC classificou como ocorrência de pesquisa' }, { at: dd + ' 10:12', t: 'Ocorrência ' + id + ' encaminhada para ' + setor });
        if (st === 'Pendente de análise') { s.status = 'ENCAMINHADA AO SETOR'; notifs.push({ id: 'n' + id, setor, oc: id, at: dd + ' 10:12', read: rnd() < 0.4 }); }
        else if (st === 'Em tratamento') { s.status = 'EM TRATAMENTO'; s.hist.push({ at: dd + ' 14:00', t: setor + ' iniciou o tratamento' }); notifs.push({ id: 'n' + id, setor, oc: id, at: dd + ' 10:12', read: true }); }
        else { s.status = 'ENCERRADA'; s.hist.push({ at: dd + ' 16:40', t: setor + ' registrou tratativa' }, { at: dd + ' 16:40', t: 'Ocorrência encerrada' }); }
      } else if (r < 0.62) {
        const id = 'MAN-' + String(manN++).padStart(4, '0');
        mans.push({ id, pesq: s.id, emp: s.emp, cli: s.razao, cnpj: s.cnpj, email: s.email, tel: s.tel, notas: 'NPS ' + s.nps + ' · Qualidade ' + s.q + ' · Prazo ' + s.p + ' · Atendimento ' + s.a, coment: s.coment || '—', at: dd + ' 10:20' });
        s.man = id; s.status = 'TRANSFORMADA EM MANIFESTAÇÃO'; s.hist.push({ at: dd + ' 10:20', t: 'Pesquisa transformada em manifestação ' + id });
      } else { s.status = 'NÃO REQUER TRATAMENTO'; s.just = 'Cliente já atendido pelo comercial na mesma semana; nota reflete episódio resolvido.'; s.hist.push({ at: dd + ' 10:18', t: 'SAC decidiu: não requer tratamento · ' + s.just }); }
    });
    const ex = surveys.filter(s => s.ano === 2026 && s.mes === 10 && s.emp === 'Chiacchio').slice(-1)[0];
    if (ex) { Object.assign(ex, { razao: 'Empresa Exemplo Ltda.', fantasia: 'Exemplo Embalagens', nps: 7, q: 8, p: 5, a: 8, canal: 'WhatsApp', coment: 'Meu último pedido chegou depois do prazo.', status: 'RECEBIDA', oc: null, man: null }); ex.hist = [{ at: this.dt(ex), t: 'Pesquisa recebida pelo link /pesquisa/chiacchio' }, { at: this.dt(ex), t: 'Nota ≤ 6 identificada automaticamente' }]; }
    return { surveys, sent, ocs: ocs.reverse(), mans, notifs: notifs.reverse(), seq, ocN, manN: Math.max(151, manN) };
  }

  openS(id) {
    const s = this.state.db.surveys.find(x => x.id === id); if (!s) return;
    if (s.status === 'RECEBIDA' && this.isLow(s)) this.mut(db => { const y = db.surveys.find(x => x.id === id); y.status = 'EM ANÁLISE'; y.hist.push({ at: this.now(), t: 'SAC iniciou a análise · Luiza Martins' }); });
    const setor = this.sug(s), lw = this.lows(s).sort((a, b) => a.v - b.v);
    const d = new Date(Date.UTC(2026, 9, 5)).toISOString().slice(0, 10);
    this.setState({ sel: id, ocSel: null, dec: { setor: setor === '—' ? 'SAC' : setor, alt: false, just: '', showOc: false, perg: lw.length ? lw[0].l : 'Recomendação (NPS)', resp: (this.K().RESP[setor] || ['Luiza Martins'])[0], prazo: d, obs: '', notify: true, force: false, jErr: false } });
  }

  renderVals() {
    const S = this.state, K = this.K();
    if (!S.db || !S.f) return { isPub: false, isInt: false, dr: {}, od: {}, md: {}, mv: {}, dec: {}, brand: {}, v: {} };
    const mode = S.mode || (this.props.modoInicial === 'Área interna' ? 'int' : 'pub');
    const slug = S.pubEmp || ({ Chiacchio: 'chiacchio', Plaschio: 'plaschio', Tubahia: 'tubahia' }[this.props.empresaPublica] || 'chiacchio');
    const empName = K.SLUG[slug];
    const P = (t, m) => ({ t, bg: (m[t] || ['#EEEEEE'])[0], fg: (m[t] || ['', '#545252'])[1] });
    const chip = (on, l, go, n) => ({ l, go, n: n == null ? '' : String(n), bg: on ? '#1F1F1F' : '#fff', fg: on ? '#fff' : '#3A3939', bd: on ? '#1F1F1F' : '#D6D6D6' });
    const scS = v => v <= 6 ? { v: String(v), bg: '#FDECEC', fg: '#A80502', fw: '700' } : v <= 8 ? { v: String(v), bg: '#F4F4F4', fg: '#3A3939', fw: '500' } : { v: String(v), bg: '#E6F2EA', fg: '#1E6B3A', fw: '600' };
    const db = S.db, all = db.surveys;

    // ---------- PUBLIC ----------
    const fm = S.form, er = S.errs, BC = slug === 'tubahia' ? '#2B2070' : '#B9171A';
    const digits = x => (x || '').replace(/\D/g, '');
    const mask = (k, v) => { const d = digits(v); if (k === 'cnpj') return d.slice(0, 14).replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2'); if (k === 'tel') return d.slice(0, 11).replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4,5})(\d{4})$/, '$1-$2'); if (k === 'cep') return d.slice(0, 8).replace(/^(\d{2})(\d{3})(\d)/, '$1.$2-$3'); return v; };
    const setFm = (k, v) => this.setState(s => { const e = Object.assign({}, s.errs); delete e[k]; return { form: Object.assign({}, s.form, { [k]: v }), errs: e }; });
    const QZp = db.qz[empName], QD = S.preview ? QZp.draft : QZp.pub;
    const rep = t => (t || '').split('[EMPRESA]').join(empName);
    const MK = { email: ['seuemail@empresa.com.br', 'email', 'email'], razao: ['Nome da sua empresa', 'text', 'text'], tel: ['(00) 00000-0000', 'tel', 'tel'], cnpj: ['00.000.000/0000-00', 'text', 'numeric'], cep: ['00.000-000', 'text', 'numeric'] };
    const itemVals = it => {
      const id = it.id, val = fm[id], err = er[id] || '', bc = err ? '#C70602' : '#D6D6D6';
      const o = { id: 'pf-' + id, l: rep(it.l), help: rep(it.help), req: it.req, err, bc, isCampo: it.kind === 'campo' || it.kind === 'curto', isLongo: it.kind === 'longo', isEscala: it.kind === 'escala', isEscolha: it.kind === 'escolha' || it.kind === 'multi' };
      if (o.isCampo || o.isLongo) { const m = MK[it.key] || ['Sua resposta', 'text', 'text']; Object.assign(o, { v: val || '', ph: m[0], type: m[1], mode: m[2], on: e => setFm(id, it.kind === 'campo' ? mask(it.key, e.target.value) : e.target.value) }); }
      if (o.isEscala) Object.assign(o, { lo: it.lo, hi: it.hi, nums: Array.from({ length: 11 }, (_, n) => { const on = val === n; return { n: String(n), aria: 'Nota ' + n, go: () => setFm(id, n), bg: on ? BC : '#fff', fg: on ? '#fff' : '#1F1F1F', bd: on ? BC : (err ? '#F0A3A1' : '#D6D6D6') }; }) });
      if (o.isEscolha) { const multi = it.kind === 'multi', cur = multi ? (val || []) : val; const list = (it.opts || []).concat(it.outro ? ['Outro'] : []); Object.assign(o, { showOutro: multi ? cur.includes('Outro') : cur === 'Outro', outroV: fm[id + '_outro'] || '', onOutro: e => setFm(id + '_outro', e.target.value), opts: list.map(x => { const on = multi ? cur.includes(x) : cur === x; return { l: x, go: () => setFm(id, multi ? (on ? cur.filter(y => y !== x) : cur.concat([x])) : x), bd: on ? BC : (err ? '#F0A3A1' : '#D6D6D6'), bg: on ? (slug === 'tubahia' ? '#F3F2FA' : '#FFF8F8') : '#fff', rc: on ? BC : '#929090', dot: on ? BC : 'transparent', rad: multi ? '5px' : '50%', rad2: multi ? '2px' : '50%' }; }) }); }
      return o;
    };
    const SECL = { dados: 'SEUS DADOS', aval: 'SUA AVALIAÇÃO', compra: 'SOBRE A COMPRA E COMENTÁRIOS' };
    const pubSecs = ['dados', 'aval', 'compra'].map(sc => ({ l: SECL[sc], items: QD.items.filter(i => i.sec === sc).map(itemVals) })).filter(x => x.items.length);
    const qt = { wT: rep(QD.texts.wT), wX: rep(QD.texts.wX), hT: rep(QD.texts.hT), h1: rep(QD.texts.h1), h2: rep(QD.texts.h2), tT: rep(QD.texts.tT), tX: rep(QD.texts.tX), nNotas: QD.items.filter(i => i.kind === 'escala').length + ' notas' };
    const submit = () => {
      const e = {}, ans = x => fm[x.id];
      QD.items.forEach(it => {
        const v0 = ans(it), empty = v0 == null || v0 === '' || (Array.isArray(v0) && !v0.length);
        if (it.req && empty) e[it.id] = it.kind === 'escala' ? 'Escolha uma nota de 0 a 10.' : it.kind === 'escolha' ? 'Escolha uma opção.' : it.kind === 'multi' ? 'Marque ao menos uma opção.' : 'Resposta obrigatória.';
        else if (!empty && it.kind === 'campo') { if (it.key === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v0)) e[it.id] = 'Informe um e-mail válido.'; if (it.key === 'tel' && digits(v0).length < 10) e[it.id] = 'Informe um telefone com DDD.'; if (it.key === 'cnpj' && digits(v0).length !== 14) e[it.id] = 'O CNPJ deve ter 14 dígitos.'; if (it.key === 'cep' && digits(v0).length !== 8) e[it.id] = 'O CEP deve ter 8 dígitos.'; }
        if (!e[it.id] && (it.kind === 'escolha' ? v0 === 'Outro' : it.kind === 'multi' && (v0 || []).includes('Outro')) && !(fm[it.id + '_outro'] || '').trim()) e[it.id] = 'Conte qual.';
      });
      if (Object.keys(e).length) { this.setState({ errs: e }); const first = QD.items.find(it => e[it.id]); const el = first && document.getElementById('pf-' + first.id); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' }); return; }
      if (S.preview) { this.setState({ sent: 'PRÉ-VISUALIZAÇÃO', closed: false, form: {}, errs: {} }); window.scrollTo(0, 0); return; }
      this.setState({ submitting: true });
      setTimeout(() => {
        const n = this.now(); let newId = '';
        const disp = it => { const v0 = fm[it.id]; if (v0 == null || v0 === '') return '—'; if (Array.isArray(v0)) return v0.map(x => x === 'Outro' ? 'Outro: ' + (fm[it.id + '_outro'] || '') : x).join(', ') || '—'; if (v0 === 'Outro') return 'Outro: ' + (fm[it.id + '_outro'] || ''); return String(v0); };
        const base = k => { const it = QD.items.find(i => i.key === k); return it ? disp(it) : '—'; };
        const custom = QD.items.filter(i => !['email', 'razao', 'tel', 'cnpj', 'cep', 'nps', 'q', 'p', 'a', 'canal', 'motivo', 'coment'].includes(i.key));
        this.mut(d => {
          d.seq[2026] = (d.seq[2026] || 0) + 1; newId = 'PESQ-2026-' + String(d.seq[2026]).padStart(6, '0');
          const s = { id: newId, emp: empName, ano: 2026, mes: 10, dia: 2, hora: n.slice(11), razao: base('razao'), fantasia: base('razao'), cnpj: base('cnpj'), email: base('email'), tel: base('tel'), cep: base('cep'), canal: base('canal'), nps: fm.nps, q: fm.q, p: fm.p, a: fm.a, motivo: base('motivo'), coment: base('coment') === '—' ? '' : base('coment'), origem: S.token ? 'Link individual' : 'Link geral', token: S.token ? '8f72k9' : '', qv: QZp.v, extra: custom.map(it => ({ l: rep(it.l), v: disp(it) })), xl: custom.filter(it => it.kind === 'escala' && it.flag && fm[it.id] != null).map(it => ({ l: rep(it.l), v: fm[it.id], setor: it.setor })), status: 'RECEBIDA', hist: [{ at: n, t: 'Pesquisa recebida pelo ' + (S.token ? 'link individual /pesquisa/' + slug + '/8f72k9' : 'link /pesquisa/' + slug) + ' · questionário v' + QZp.v }], oc: null, man: null, just: '' };
          if (this.isLow(s)) s.hist.push({ at: n, t: 'Nota ≤ 6 identificada automaticamente' });
          d.surveys.push(s);
        });
        this.setState({ sent: newId, started: false, closed: false, submitting: false, form: {}, errs: {} }); window.scrollTo(0, 0);
      }, 500);
    };
    const tokenData = { chiacchio: ['compras@exemploembalagens.com.br', 'Empresa Exemplo Ltda.', '(77) 98100-1000', '10.100.200/0001-10', '45.010-100'], plaschio: ['compras@modeloatacado.com.br', 'Comércio Modelo S.A.', '(77) 98113-1071', '17.137.253/0001-13', '45.011-109'], tubahia: ['compras@testealimentos.com.br', 'Indústria Teste Ltda.', '(77) 98126-1142', '24.174.306/0001-16', '45.012-118'] };
    const setPub = sl => this.setState({ pubEmp: sl, preview: false, started: false, sent: null, closed: false, form: S.token ? this.prefill(tokenData[sl]) : {}, errs: {} });

    // ---------- INTERNAL ----------
    const F = S.f;
    const setF = (k, val) => { this.setState({ f: Object.assign({}, S.f, { [k]: val }), limit: 40, loading: true }); clearTimeout(this._l); this._l = setTimeout(() => this.setState({ loading: false }), 350); };
    const notaOk = (s, n) => n === 'Todas' || (n === 'Com nota ≤ 6' && this.isLow(s)) || (n === 'Promotor (NPS 9–10)' && s.nps >= 9) || (n === 'Neutro (NPS 7–8)' && s.nps >= 7 && s.nps <= 8) || (n === 'Detrator (NPS 0–6)' && s.nps <= 6);
    const ocOf = id => db.ocs.find(o => o.id === id);
    const setorOf = s => s.oc && ocOf(s.oc) ? ocOf(s.oc).setor : this.sug(s);
    const filt = (list, f) => list.filter(s => (f.emp === 'Todas' || s.emp === f.emp) && (f.ano === 'Todos' || String(s.ano) === f.ano) && (f.mes === 'Todos' || String(s.mes) === f.mes) && (!f.de || this.iso(s) >= f.de) && (!f.ate || this.iso(s) <= f.ate) && (!f.cli || (s.razao + ' ' + s.fantasia + ' ' + s.cnpj).toLowerCase().includes(f.cli.toLowerCase())) && notaOk(s, f.nota) && (f.canal === 'Todos' || s.canal === f.canal) && (f.setor === 'Todos' || setorOf(s) === f.setor) && (f.status === 'Todos' || s.status === f.status) && (f.origem === 'Todas' || s.origem === f.origem));
    const sortD = l => l.slice().sort((x, y) => (this.iso(y) + y.hora).localeCompare(this.iso(x) + x.hora));
    const sentFor = f => Object.keys(db.sent).reduce((a, k) => { const [e, y, m] = k.split('|'); return a + (((f.emp === 'Todas' || e === f.emp) && (f.ano === 'Todos' || y === f.ano) && (f.mes === 'Todos' || m === f.mes)) ? db.sent[k] : 0); }, 0);
    const stats = (l, sent) => { const n = l.length, prom = l.filter(s => s.nps >= 9).length, det = l.filter(s => s.nps <= 6).length; const sat = n ? l.reduce((a, s) => a + s.q + s.p + s.a, 0) / (3 * n) : null; return { n, prom, det, neu: n - prom - det, nps: n ? Math.round((prom - det) / n * 100) : null, sat, low: l.filter(s => this.isLow(s)).length, ocs: l.filter(s => s.oc).length, mans: l.filter(s => s.man).length, taxa: sent ? Math.min(100, Math.round(n / sent * 100)) : null, sent }; };
    const pct = (a, n) => n ? Math.round(a / n * 100) + '%' : '—';
    const kpiList = st => [['PESQUISAS RECEBIDAS', st.n, 'no recorte', '#1F1F1F'], ['TAXA DE RESPOSTA', st.taxa == null ? '—' : st.taxa + '%', st.sent + ' enviadas', '#929090'], ['NPS', st.nps == null ? '—' : st.nps, 'promotores − detratores', '#C70602'], ['SATISFAÇÃO MÉDIA', st.sat == null ? '—' : st.sat.toFixed(1).replace('.', ','), 'qualidade, prazo, atendimento', '#929090'], ['PROMOTORES', st.prom, pct(st.prom, st.n) + ' · NPS 9–10', '#1E6B3A'], ['NEUTROS', st.neu, pct(st.neu, st.n) + ' · NPS 7–8', '#929090'], ['DETRATORES', st.det, pct(st.det, st.n) + ' · NPS 0–6', '#A80502'], ['NOTAS BAIXAS', st.low, 'alguma nota ≤ 6', '#C70602'], ['OCORRÊNCIAS GERADAS', st.ocs, 'sinalizações a setores', '#D9A400'], ['MANIFESTAÇÕES GERADAS', st.mans, 'manifestações formais', '#A80502']].map(([l, v, d, c]) => ({ l, v: String(v), d, c }));
    const row = s => ({ id: s.id, data: this.dt(s), emp: s.emp, cli: s.fantasia && s.fantasia !== s.razao ? s.razao + ' · ' + s.fantasia : s.razao, sc: [s.nps, s.q, s.p, s.a].map(scS), canal: s.canal, st: P(s.status, K.STC), low: this.isLow(s), rb: s.status === 'RECEBIDA' || s.status === 'EM ANÁLISE' ? (this.isLow(s) ? '#FFFAFA' : '#fff') : '#fff', go: () => this.openS(s.id) });

    const list = sortD(filt(all, F)), st = stats(list, sentFor(F));
    const unreadN = db.notifs.filter(n => !n.read).length;
    const TABS = [['geral', 'Visão geral'], ['anomes', 'Por ano e mês'], ['empresa', 'Por empresa'], ['dash', 'Dashboard'], ['coment', 'Comentários'], ['ocs', 'Ocorrências'], ['quest', 'Questionário'], ['notifs', 'Notificações']];
    const tabs = TABS.map(([k, l]) => { const on = S.tab === k; return { l, n: k === 'notifs' && unreadN ? String(unreadN) : '', go: () => this.setState({ tab: k }), fg: on ? '#1F1F1F' : '#666464', bd: on ? '#C70602' : 'transparent', fw: on ? '700' : '500' }; });
    const v = {}; v[S.tab] = true;
    const opt = a => a.map(x => Array.isArray(x) ? { v: x[0], l: x[1] } : { v: x, l: x });
    const full = S.tab === 'geral' || S.tab === 'ocs';
    const FS = [['emp', 'Empresa', opt(['Todas'].concat(K.EMP))], ['ano', 'Ano', opt(['Todos', '2026', '2025'])], ['mes', 'Mês', opt([['Todos', 'Todos']].concat(K.MN.slice(1).map((m, i) => [String(i + 1), m])))]].concat(full ? [['nota', 'Nota', opt(['Todas', 'Com nota ≤ 6', 'Promotor (NPS 9–10)', 'Neutro (NPS 7–8)', 'Detrator (NPS 0–6)'])], ['canal', 'Canal', opt(['Todos'].concat(K.CANAIS))], ['setor', 'Setor', opt(['Todos'].concat(K.SETORES))], ['status', 'Status', opt(['Todos'].concat(K.STATUS))], ['origem', 'Origem', opt(['Todas', 'Link geral', 'Link individual'])]] : []);
    const fSelects = FS.map(([k, l, o]) => ({ l, o, v: F[k], on: e => setF(k, e.target.value), bd: F[k] !== this.F0()[k] ? '#C70602' : '#D6D6D6' }));
    const shown = list.slice(0, S.limit);

    // ano/mes tree
    const tr = S.tr;
    const years = [2026, 2025].map(y => { const yl = all.filter(s => s.ano === y); const ms = K.MONTHS.filter(m => m[0] === y).map(m => m[1]).sort((a, b) => b - a); return { l: String(y), n: String(yl.length), open: tr.openY === y, sign: tr.openY === y ? '▾' : '▸', go: () => this.setState({ tr: Object.assign({}, tr, { openY: tr.openY === y ? null : y }) }), months: ms.map(m => { const key = y + '-' + m, ml = yl.filter(s => s.mes === m), op = tr.openM === key; return { l: K.MN[m], n: String(ml.length), open: op, sign: op ? '▾' : '▸', bg: op ? '#F4F4F4' : 'transparent', go: () => this.setState({ tr: Object.assign({}, tr, { openM: op ? null : key }) }), emps: K.EMP.map(e => { const on = tr.ano === y && tr.mes === m && tr.emp === e; return { l: e, n: String(ml.filter(s => s.emp === e).length), go: () => this.setState({ tr: Object.assign({}, tr, { ano: y, mes: m, emp: e }) }), bg: on ? '#FDECEC' : 'transparent', fg: on ? '#A80502' : '#3A3939', fw: on ? '700' : '500', bl: on ? '#C70602' : '#E4E4E4' }; }) }; }) }; });
    const tl = sortD(all.filter(s => s.ano === tr.ano && s.mes === tr.mes && s.emp === tr.emp)), ts = stats(tl, db.sent[tr.emp + '|' + tr.ano + '|' + tr.mes] || 0);

    // por empresa
    const fNoEmp = Object.assign({}, F, { emp: 'Todas' });
    const empCards = K.EMP.map(e => { const l = filt(all, Object.assign({}, fNoEmp, { emp: e })), s2 = stats(l, sentFor(Object.assign({}, F, { emp: e }))); const last6 = K.MONTHS.slice(-6).map(([y, m]) => { const ml = all.filter(s => s.emp === e && s.ano === y && s.mes === m), mst = stats(ml, 0); return { l: K.MS[m], v: mst.nps == null ? '—' : String(mst.nps), h: (mst.nps == null ? 0 : Math.max(3, mst.nps)) + '%' }; }); return { up: e.toUpperCase(), url: '/pesquisa/' + e.toLowerCase(), spark: last6, k: kpiList(s2).map(k => ({ l: k.l, v: k.v, c: k.l === 'NOTAS BAIXAS' || k.l === 'DETRATORES' ? '#A80502' : '#1F1F1F' })), go: () => this.setState({ tab: 'geral', f: Object.assign({}, F, { emp: e }) }) }; });

    // dashboard
    const keys = K.MONTHS.filter(([y]) => S.dPer === '12m' || String(y) === S.dPer);
    const dl = all.filter(s => S.dEmp === 'Todas' || s.emp === S.dEmp);
    const per = keys.map(([y, m]) => { const ml = dl.filter(s => s.ano === y && s.mes === m); return { y, m, l: ml, st: stats(ml, 0) }; });
    const avg = (l, k) => l.length ? l.reduce((a, s) => a + s[k], 0) / l.length : null;
    const mk = (t, s, vals, fmt, color, max) => { const mx = max || Math.max(1, ...vals.map(x => Math.max(0, x || 0))); return { t, s, items: per.map((p, i) => ({ l: K.MS[p.m], v: vals[i] == null ? '—' : fmt(vals[i]), h: (vals[i] == null ? 0 : Math.max(2, Math.max(0, vals[i]) / mx * 100)) + '%', c: typeof color === 'function' ? color(vals[i]) : color })) }; };
    const f1 = x => x.toFixed(1).replace('.', ','), fi = x => String(Math.round(x));
    const distAll = dl.filter(s => keys.some(([y, m]) => s.ano === y && s.mes === m));
    const dist = Array.from({ length: 11 }, (_, n) => distAll.filter(s => s.nps === n).length), dmax = Math.max(1, ...dist);
    const charts = [mk('NPS por mês', 'Promotores − detratores', per.map(p => p.st.nps), fi, '#C70602', 100), mk('Satisfação média por mês', 'Média de qualidade, prazo e atendimento (0–10)', per.map(p => p.st.sat), f1, '#545252', 10), mk('Pesquisas recebidas por mês', 'Quantidade de respostas', per.map(p => p.st.n), fi, '#1F1F1F'), mk('Notas ≤ 6 por mês', 'Pesquisas com alguma nota baixa', per.map(p => p.st.low), fi, '#C70602'), mk('Ocorrências por mês', 'Ocorrências de pesquisa geradas', per.map(p => p.st.ocs), fi, '#D9A400'), mk('Manifestações geradas por mês', 'Pesquisas transformadas em manifestação formal', per.map(p => p.st.mans), fi, '#A80502'),
      { t: 'Distribuição das notas de NPS (0 a 10)', s: 'Vermelho: detratores · cinza: neutros · verde: promotores', items: dist.map((c, n) => ({ l: String(n), v: String(c), h: Math.max(2, c / dmax * 100) + '%', c: n <= 6 ? '#C70602' : n <= 8 ? '#929090' : '#1E6B3A' })) },
      mk('Qualidade dos produtos', 'Média mensal (0–10)', per.map(p => avg(p.l, 'q')), f1, '#545252', 10), mk('Prazo de entrega', 'Média mensal (0–10)', per.map(p => avg(p.l, 'p')), f1, '#545252', 10), mk('Atendimento', 'Média mensal (0–10)', per.map(p => avg(p.l, 'a')), f1, '#545252', 10)];

    // comentários
    const fC = Object.assign({}, F, { nota: 'Todas', canal: 'Todos', setor: 'Todos', status: 'Todos', origem: 'Todas', cli: '', de: '', ate: '' });
    const cBase = sortD(filt(all, fC).filter(s => s.coment));
    const CF = [['Todos', () => true], ['Notas baixas', s => this.isLow(s)], ['Pendentes', s => s.status === 'RECEBIDA' || s.status === 'EM ANÁLISE'], ['Ocorrências', s => !!s.oc], ['Manifestações', s => !!s.man]];
    const cfn = (CF.find(c => c[0] === S.cf) || CF[0])[1];
    const cList = cBase.filter(cfn);
    const coms = cList.slice(0, S.cLimit).map(s => { const mn = Math.min(s.nps, s.q, s.p, s.a), lw = K.Q.find(([k]) => s[k] === mn); return { id: s.id, cli: s.razao, emp: s.emp, data: this.dt(s), coment: s.coment, nota: String(mn), nc: mn <= 6 ? '#A80502' : '#1F1F1F', perg: lw[1], setor: setorOf(s), st: P(s.status, K.STC), lc: this.isLow(s) ? '#C70602' : '#E4E4E4', go: () => this.openS(s.id) }; });
    const cChips = CF.map(([l, fn]) => chip(S.cf === l, l, () => this.setState({ cf: l, cLimit: 20 }), cBase.filter(fn).length));

    // ocorrências
    const ocVis = db.ocs.filter(o => { const s = all.find(x => x.id === o.pesq); return s && filt([s], Object.assign({}, F, { setor: 'Todos', status: 'Todos' })).length && (F.setor === 'Todos' || o.setor === F.setor); });
    const ocRows = ocVis.map(o => ({ id: o.id, pesq: o.pesq, emp: o.emp, cli: o.cli, perg: o.perg, nota: String(o.nota), setor: o.setor, resp: o.resp, prazo: o.prazo.includes('-') ? o.prazo.split('-').reverse().join('/') : o.prazo, st: P(o.status, K.OCST), go: () => this.setState({ ocSel: o.id, trat: o.trat || '' }) }));

    // notifs
    const NS = ['Todos', 'Qualidade', 'Logística', 'Comercial / Atendimento', 'SAC'];
    const nChips = NS.map(x => chip(S.nSet === x, x, () => this.setState({ nSet: x }), db.notifs.filter(n => (x === 'Todos' || n.setor === x) && !n.read).length));
    const readN = id => this.mut(d => { const n = d.notifs.find(x => x.id === id); if (n) n.read = true; });
    const notifs = db.notifs.filter(n => S.nSet === 'Todos' || n.setor === S.nSet).map(n => { const o = ocOf(n.oc) || {}; return { at: n.at, oc: n.oc, unread: !n.read, op: n.read ? '0.82' : '1', tc: n.read ? '#E4E4E4' : '#D9A400', f: [{ l: 'Cliente', v: o.cli, fw: '600' }, { l: 'Empresa', v: o.emp, fw: '500' }, { l: 'Avaliação', v: o.perg, fw: '500' }, { l: 'Nota', v: String(o.nota), fw: '700', c: '#A80502' }, { l: 'Comentário', v: o.coment === '—' ? '—' : '“' + o.coment + '”', fw: '400' }, { l: 'Setor sugerido', v: (o.setor || '').toUpperCase(), fw: '700' }, { l: 'Status', v: o.status, fw: '600' }].map(x => Object.assign({ c: '#1F1F1F' }, x)), read: () => readN(n.id), open: () => { readN(n.id); this.setState({ ocSel: n.oc, trat: o.trat || '' }); } }; });

    // drawer: survey
    const s = S.sel ? all.find(x => x.id === S.sel) : null;
    let dr = { show: false }, dec = {};
    if (s) {
      const low = this.isLow(s), pend = s.status === 'RECEBIDA' || s.status === 'EM ANÁLISE', D = S.dec;
      const setD = (k, val) => this.setState(st0 => ({ dec: Object.assign({}, st0.dec, { [k]: val }) }));
      const lows = this.lows(s);
      dr = { show: true, id: s.id, st: P(s.status, K.STC), emp: s.emp, data: this.dt(s), origem: s.origem + (s.token ? ' · ' + s.token : '') + ' · questionário v' + (s.qv || 1), alert: low, lows: lows.map(l => ({ l: l.l, v: String(l.v) })),
        notas: K.Q.map(([k, l]) => { const x = s[k]; return { l: { nps: 'NPS', q: 'Qualidade', p: 'Prazo de entrega', a: 'Atendimento' }[k], v: String(x), bg: x <= 6 ? '#FDECEC' : x <= 8 ? '#fff' : '#E6F2EA', fg: x <= 6 ? '#A80502' : x <= 8 ? '#1F1F1F' : '#1E6B3A' }; }),
        cli: [['Razão social', s.razao], ['Nome fantasia', s.fantasia || '—'], ['CNPJ', s.cnpj], ['E-mail', s.email], ['Telefone', s.tel], ['CEP', s.cep]].map(([l, x]) => ({ l, v: x })),
        canal: s.canal, motivo: s.motivo, coment: s.coment || 'Sem comentário.', hasExtra: !!(s.extra && s.extra.length), extra: s.extra || [],
        links: !!(s.oc || s.man), hasOc: !!s.oc, oc: s.oc, hasMan: !!s.man, man: s.man, openOc: () => this.setState({ ocSel: s.oc, trat: (ocOf(s.oc) || {}).trat || '' }), openMan: () => this.setState({ mvId: s.man, modal: null }),
        canAct: pend && (low || D.force), actTitle: low ? 'Análise da nota baixa · decisão do SAC' : 'Análise da pesquisa · decisão do SAC',
        canClose: pend && !low && !D.force, analyze: () => setD('force', true),
        close: () => this.mut(d => { const y = d.surveys.find(x => x.id === s.id); y.status = 'ENCERRADA'; y.hist.push({ at: this.now(), t: 'SAC encerrou a pesquisa · sem notas ≤ 6' }); }),
        hist: s.hist.slice().reverse().map(h => ({ at: h.at, t: h.t, c: /manifesta/i.test(h.t) ? '#C70602' : /ocorr|setor|tratamento|tratativa/i.test(h.t) ? '#D9A400' : /Nota ≤ 6/.test(h.t) ? '#A80502' : '#929090' })) };
      const setorUp = (D.setor || '').toUpperCase();
      const pergO = (lows.length ? lows : K.Q.map(([k, l]) => ({ l }))).map(x => x.l);
      dec = { setor: D.setor, setorUp, isAlt: !!D.alt, notAlt: !D.alt, alt: () => setD('alt', true), onSetor: e => this.setState({ dec: Object.assign({}, D, { setor: e.target.value, resp: (K.RESP[e.target.value] || ['[Nome]'])[0] }) }), why: lows.length ? 'pela menor nota: ' + lows.slice().sort((a, b) => a.v - b.v)[0].l.toLowerCase() : '',
        just: D.just, onJust: e => this.setState({ dec: Object.assign({}, S.dec, { just: e.target.value, jErr: false }) }), jbc: D.jErr ? '#C70602' : '#D6D6D6',
        showOc: !!D.showOc, toOc: () => setD('showOc', true), cancelOc: () => setD('showOc', false),
        perg: D.perg, pergO, onPerg: e => setD('perg', e.target.value), resp: D.resp, respO: K.RESP[D.setor] || ['[Nome]'], onResp: e => setD('resp', e.target.value), prazo: D.prazo, onPrazo: e => setD('prazo', e.target.value), obs: D.obs, onObs: e => setD('obs', e.target.value),
        nj: D.notify ? 'flex-end' : 'flex-start', nb: D.notify ? '#7A4C00' : '#C4C4C4', togNotify: () => setD('notify', !D.notify), createL: D.notify ? 'Criar ocorrência e notificar ' + D.setor : 'Criar ocorrência',
        createOc: () => { const n = this.now(); let id = ''; this.mut(d => { id = 'OCP-2026-' + String(d.ocN++).padStart(4, '0'); const y = d.surveys.find(x => x.id === s.id); const nota = (lows.find(l => l.l === D.perg) || { v: s[K.Q.find(q => q[1] === D.perg)[0]] }).v; const oh = [{ at: n, t: 'Ocorrência criada a partir de ' + s.id + ' por Luiza Martins (SAC)' }]; if (D.notify) oh.push({ at: n, t: 'Notificação enviada ao setor ' + D.setor }); d.ocs.unshift({ id, pesq: s.id, emp: s.emp, cli: s.razao, data: n.slice(0, 10), nota, perg: D.perg, coment: s.coment || '—', setor: D.setor, resp: D.resp, prazo: D.prazo, status: D.notify ? 'Pendente de análise' : 'Gerada · não encaminhada', trat: '', obs: D.obs || '—', hist: oh }); y.oc = id; y.hist.push({ at: n, t: 'SAC classificou como ocorrência de pesquisa' + (D.just ? ' · ' + D.just : '') }); if (D.notify) { y.status = 'ENCAMINHADA AO SETOR'; y.hist.push({ at: n, t: 'Ocorrência ' + id + ' encaminhada para ' + D.setor }); d.notifs.unshift({ id: 'n' + Date.now(), setor: D.setor, oc: id, at: n, read: false }); } else { y.status = 'OCORRÊNCIA GERADA'; y.hist.push({ at: n, t: 'Ocorrência ' + id + ' gerada, ainda não encaminhada' }); } }); this.setState({ dec: Object.assign({}, D, { showOc: false }) }); this.flash('Ocorrência ' + id + (D.notify ? ' criada e ' + D.setor + ' notificada.' : ' criada.')); },
        toMan: () => this.setState({ modal: 'conf' }),
        noTrat: () => { if ((D.just || '').trim().length < 10) { this.setState({ dec: Object.assign({}, D, { jErr: true }) }); return this.flash('Justifique a decisão (mínimo de 10 caracteres).'); } this.mut(d => { const y = d.surveys.find(x => x.id === s.id); y.status = 'NÃO REQUER TRATAMENTO'; y.just = D.just.trim(); y.hist.push({ at: this.now(), t: 'SAC decidiu: não requer tratamento · ' + D.just.trim() }); }); this.flash('Decisão registrada com justificativa.'); } };
    }
    const md = { conf: S.modal === 'conf' && !!s, links: S.modal === 'links', pub: S.modal === 'pub', pesq: s ? s.id : '', copy: ['Dados do cliente', 'Comentário', 'Notas da pesquisa', 'Canal e motivo', 'Origem: pesquisa de satisfação', 'Vínculo de rastreabilidade'],
      ok: () => { const n = this.now(); let id = ''; this.mut(d => { id = 'MAN-' + String(d.manN++).padStart(4, '0'); const y = d.surveys.find(x => x.id === s.id); d.mans.unshift({ id, pesq: s.id, emp: s.emp, cli: s.razao, cnpj: s.cnpj, email: s.email, tel: s.tel, notas: 'NPS ' + s.nps + ' · Qualidade ' + s.q + ' · Prazo ' + s.p + ' · Atendimento ' + s.a, coment: s.coment || '—', at: n }); y.man = id; y.status = 'TRANSFORMADA EM MANIFESTAÇÃO'; y.hist.push({ at: n, t: 'Pesquisa transformada em manifestação ' + id + (S.dec.just ? ' · ' + S.dec.just : '') }); }); this.setState({ modal: null, mvId: id }); } };
    const man = S.mvId ? db.mans.find(m => m.id === S.mvId) : null;
    const mv = man ? { show: true, id: man.id, pesq: man.pesq, coment: man.coment, f: [['Cliente', man.cli], ['Empresa', man.emp], ['CNPJ', man.cnpj], ['E-mail', man.email], ['Telefone', man.tel], ['Notas da pesquisa', man.notas], ['Tipo', 'Reclamação (a confirmar na análise)'], ['Registrada em', man.at]].map(([l, x]) => ({ l, v: x })), back: () => { this.setState({ mvId: null }); this.openS(man.pesq); } } : { show: false };

    // drawer: ocorrência
    const o = S.ocSel ? ocOf(S.ocSel) : null;
    let od = { show: false };
    if (o) {
      const FLOW = ['Pendente de análise', 'Em tratamento', 'Encerrada'], idx = FLOW.indexOf(o.status);
      const upO = (fn, sfn) => this.mut(d => { const x = d.ocs.find(y => y.id === o.id); fn(x, this.now()); const y = d.surveys.find(z => z.id === o.pesq); if (y && sfn) sfn(y, this.now(), d); });
      od = { show: true, id: o.id, pesq: o.pesq, st: P(o.status, K.OCST), setorUp: o.setor.toUpperCase(), coment: o.coment, obs: o.obs || '—',
        steps: ['Gerada', 'Pendente de análise', 'Em tratamento', 'Encerrada'].map((l, i) => { const cur = o.status === 'Gerada · não encaminhada' ? 0 : idx + 1; return { l, a: i < 3 ? '→' : '', bg: i < cur ? '#E6F2EA' : i === cur ? '#D9A400' : '#EEEEEE', fg: i < cur ? '#1E6B3A' : i === cur ? '#fff' : '#666464' }; }),
        f: [['ID da ocorrência', o.id], ['ID da pesquisa', o.pesq], ['Cliente', o.cli], ['Empresa', o.emp], ['Data', o.data], ['Pergunta avaliada', o.perg], ['Nota', String(o.nota)], ['Setor relacionado', o.setor], ['Responsável', o.resp], ['Prazo', o.prazo.includes('-') ? o.prazo.split('-').reverse().join('/') : o.prazo], ['Status', o.status]].map(([l, x]) => ({ l, v: x, fw: l === 'Nota' ? '700' : '500', c: l === 'Nota' ? '#A80502' : '#1F1F1F' })),
        trat: S.trat, onTrat: e => this.setState({ trat: e.target.value }), tratDis: o.status === 'Encerrada', tbc: '#D6D6D6',
        hist: o.hist.slice().reverse(), verP: () => { this.setState({ ocSel: null }); this.openS(o.pesq); },
        canFwd: o.status === 'Gerada · não encaminhada', fwd: () => { upO((x, n) => { x.status = 'Pendente de análise'; x.hist.push({ at: n, t: 'Encaminhada ao setor ' + x.setor }, { at: n, t: 'Notificação enviada ao setor ' + x.setor }); }, (y, n, d) => { y.status = 'ENCAMINHADA AO SETOR'; y.hist.push({ at: n, t: 'Ocorrência ' + o.id + ' encaminhada para ' + o.setor }); d.notifs.unshift({ id: 'n' + Date.now(), setor: o.setor, oc: o.id, at: n, read: false }); }); this.flash(o.setor + ' notificada.'); },
        canStart: o.status === 'Pendente de análise', start: () => upO((x, n) => { x.status = 'Em tratamento'; x.hist.push({ at: n, t: x.setor + ' iniciou o tratamento · ' + x.resp }); }, (y, n) => { y.status = 'EM TRATAMENTO'; y.hist.push({ at: n, t: o.setor + ' iniciou o tratamento da ocorrência ' + o.id }); }),
        canEnd: o.status === 'Em tratamento', end: () => { if ((S.trat || '').trim().length < 10) return this.flash('Descreva a tratativa do setor antes de encerrar.'); upO((x, n) => { x.status = 'Encerrada'; x.trat = S.trat.trim(); x.hist.push({ at: n, t: x.setor + ' registrou tratativa: ' + x.trat }, { at: n, t: 'Ocorrência encerrada' }); }, (y, n) => { y.status = 'ENCERRADA'; y.hist.push({ at: n, t: o.setor + ' registrou tratativa' }, { at: n, t: 'Ocorrência ' + o.id + ' encerrada' }); }); this.flash('Ocorrência encerrada e registrada no histórico.'); } };
    }


    // ---------- EDITOR DO QUESTIONÁRIO ----------
    const qEmp = S.qEmp || 'Chiacchio', QZ = db.qz[qEmp], DR = QZ.draft;
    const dirty = JSON.stringify(DR) !== JSON.stringify(QZ.pub);
    const mutQ = fn => this.mut(d => fn(d.qz[qEmp].draft, d.qz[qEmp]));
    const repE = t => (t || '').split('[EMPRESA]').join(qEmp);
    const TL = { campo: 'Dado do cliente', curto: 'Resposta curta', longo: 'Resposta longa', escala: 'Escala 0–10', escolha: 'Múltipla escolha', multi: 'Caixas de seleção' };
    const FIXREQ = ['email', 'razao', 'cnpj', 'nps', 'q', 'p', 'a'];
    const ESL = { dados: 'SEUS DADOS', aval: 'SUA AVALIAÇÃO', compra: 'SOBRE A COMPRA E COMENTÁRIOS' };
    const qSel = S.qSel || 'textos';
    const newItem = (kind, sec) => ({ id: 'c' + Date.now(), key: 'c' + Date.now(), kind, sec, l: kind === 'escala' ? 'Em uma escala de 0 a 10, como você avalia…' : 'Nova pergunta', req: false, base: false, del: true, help: '', lo: 'Péssimo', hi: 'Excelente', opts: kind === 'escolha' || kind === 'multi' ? ['Opção 1', 'Opção 2'] : null, outro: false, flag: kind === 'escala', setor: 'SAC' });
    const move = (id, dir) => mutQ(dr => { const i = dr.items.findIndex(x => x.id === id), it = dr.items[i]; let j = i + dir; while (j >= 0 && j < dr.items.length && dr.items[j].sec !== it.sec) j += dir; if (j < 0 || j >= dr.items.length) return; dr.items[i] = dr.items[j]; dr.items[j] = it; });
    const qeSecs = ['dados', 'aval', 'compra'].map(sec => { const its = DR.items.filter(i => i.sec === sec); return { l: ESL[sec], n: String(its.length), addOpen: S.qAdd === sec, add: () => this.setState({ qAdd: S.qAdd === sec ? null : sec }),
      addOpts: ['escala', 'escolha', 'multi', 'curto', 'longo'].map(k => ({ l: TL[k], go: () => { const ni = newItem(k, sec); mutQ(dr => { const last = dr.items.map(x => x.sec).lastIndexOf(sec); dr.items.splice(last + 1, 0, ni); }); this.setState({ qSel: ni.id, qAdd: null }); } })),
      items: its.map((it, k) => { const on = qSel === it.id; const chips = [{ t: it.req ? 'Obrigatória' : 'Opcional', bg: it.req ? '#FDECEC' : '#F4F4F4', fg: it.req ? '#A80502' : '#666464' }]; if (it.base) chips.push({ t: 'Base dos indicadores', bg: '#EEEEEE', fg: '#545252' }); if (it.kind === 'escala' && (it.base || it.flag)) chips.push({ t: 'Sinaliza nota ≤ 6', bg: '#FBF0D9', fg: '#7A4C00' }); if (it.opts) chips.push({ t: it.opts.length + (it.outro ? ' + Outro' : '') + ' opções', bg: '#F4F4F4', fg: '#545252' });
        return { n: String(DR.items.indexOf(it) + 1), l: repE(it.l), tipo: TL[it.kind], chips, bg: on ? '#FFF8F8' : '#fff', bl: on ? '#C70602' : 'transparent', go: () => this.setState({ qSel: it.id }), up: () => move(it.id, -1), down: () => move(it.id, 1), noUp: k === 0, noDown: k === its.length - 1, upOp: k === 0 ? '0.35' : '1', downOp: k === its.length - 1 ? '0.35' : '1', canDel: it.del, lock: !it.del,
          dup: () => { const ni = Object.assign(JSON.parse(JSON.stringify(it)), { id: 'c' + Date.now(), key: 'c' + Date.now(), base: false, del: true, l: it.l + ' (cópia)', flag: it.kind === 'escala', setor: it.base ? (K.SET[it.key] || 'SAC') : it.setor }); mutQ(dr => { dr.items.splice(dr.items.findIndex(x => x.id === it.id) + 1, 0, ni); }); this.setState({ qSel: ni.id }); },
          del: () => { mutQ(dr => { dr.items = dr.items.filter(x => x.id !== it.id); }); this.setState({ qSel: 'textos' }); this.flash('Pergunta removida do rascunho.'); } }; }) }; });
    const SI = DR.items.find(i => i.id === qSel);
    let qi = {};
    if (SI) {
      const up = (k, v) => mutQ(dr => { const x = dr.items.find(y => y.id === SI.id); x[k] = v; });
      const fixedReq = FIXREQ.includes(SI.key);
      qi = { n: String(DR.items.indexOf(SI) + 1), base: SI.base, kind: SI.kind, kinds: (SI.base ? [SI.kind] : ['escala', 'escolha', 'multi', 'curto', 'longo']).map(k => ({ v: k, l: TL[k] })),
        onKind: e => { const k = e.target.value; mutQ(dr => { const x = dr.items.find(y => y.id === SI.id); x.kind = k; if ((k === 'escolha' || k === 'multi') && !x.opts) x.opts = ['Opção 1', 'Opção 2']; if (k === 'escala') x.flag = true; }); },
        l: SI.l, onL: e => up('l', e.target.value), help: SI.help || '', onHelp: e => up('help', e.target.value),
        canSec: !SI.base, sec: SI.sec, secs: Object.keys(ESL).map(k => ({ v: k, l: ESL[k] })), onSec: e => up('sec', e.target.value),
        rj: SI.req ? 'flex-end' : 'flex-start', rb: SI.req ? '#C70602' : '#C4C4C4', reqOp: fixedReq ? '0.6' : '1', reqNote: fixedReq ? ' · fixa (identificação/indicadores)' : '', togReq: () => fixedReq ? this.flash('Esta pergunta é sempre obrigatória: ela alimenta a identificação do cliente ou os indicadores.') : up('req', !SI.req),
        isEscala: SI.kind === 'escala', lo: SI.lo, hi: SI.hi, onLo: e => up('lo', e.target.value), onHi: e => up('hi', e.target.value),
        flagFixed: SI.base && SI.kind === 'escala', setorFixed: K.SET[SI.key] || 'SAC', canFlag: !SI.base && SI.kind === 'escala', flag: !!SI.flag, fj: SI.flag ? 'flex-end' : 'flex-start', fb: SI.flag ? '#7A4C00' : '#C4C4C4', togFlag: () => up('flag', !SI.flag), setor: SI.setor, onSetor: e => up('setor', e.target.value),
        isOpts: !!SI.opts && (SI.kind === 'escolha' || SI.kind === 'multi'), rad: SI.kind === 'multi' ? '3px' : '50%',
        opts: (SI.opts || []).map((o, i) => ({ v: o, on: e => { const v = e.target.value; mutQ(dr => { dr.items.find(y => y.id === SI.id).opts[i] = v; }); }, del: () => { if (SI.opts.length <= 1) return this.flash('A pergunta precisa de ao menos uma opção.'); mutQ(dr => { dr.items.find(y => y.id === SI.id).opts.splice(i, 1); }); } })),
        addOpt: () => mutQ(dr => { const x = dr.items.find(y => y.id === SI.id); x.opts.push('Opção ' + (x.opts.length + 1)); }),
        oj: SI.outro ? 'flex-end' : 'flex-start', ob: SI.outro ? '#C70602' : '#C4C4C4', togOutro: () => up('outro', !SI.outro) };
    }
    const TX = [['wT', 'Boas-vindas · título', 0], ['wX', 'Boas-vindas · texto', 1], ['hT', 'Formulário · título (exibido em caixa alta)', 0], ['h1', 'Formulário · frase de destaque', 1], ['h2', 'Formulário · texto', 1], ['tT', 'Agradecimento · título', 0], ['tX', 'Agradecimento · texto', 1]];
    const nResp = v0 => all.filter(x => x.emp === qEmp && (x.qv || 1) === v0).length;
    const qe = { emp: qEmp, url: '/pesquisa/' + qEmp.toLowerCase(), emps: K.EMP.map(x => chip(qEmp === x, x, () => this.setState({ qEmp: x, qSel: 'textos', qAdd: null }))), others: K.EMP.filter(x => x !== qEmp),
      st: dirty ? { t: 'Alterações não publicadas', bg: '#FBF0D9', fg: '#7A4C00' } : { t: 'Publicado · v' + QZ.v, bg: '#E6F2EA', fg: '#1E6B3A' }, pubInfo: 'Versão publicada v' + QZ.v + ' em ' + QZ.at + ' por ' + QZ.by, dirty, nextV: 'v' + (QZ.v + 1), pubBg: dirty ? '#C70602' : '#C4C4C4',
      askPub: () => dirty ? this.setState({ modal: 'pub', pubNote: '' }) : this.flash('Não há alterações para publicar.'),
      discard: () => { this.mut(d => { d.qz[qEmp].draft = JSON.parse(JSON.stringify(d.qz[qEmp].pub)); }); this.setState({ qSel: 'textos' }); this.flash('Rascunho descartado. Voltou para a versão v' + QZ.v + '.'); },
      copyFrom: e => { const o = e.target.value; if (!o) return; this.mut(d => { d.qz[qEmp].draft = JSON.parse(JSON.stringify(d.qz[o].draft)); }); this.setState({ qSel: 'textos' }); this.flash('Questionário de ' + o + ' copiado para o rascunho de ' + qEmp + '.'); },
      preview: () => { this.setState({ mode: 'pub', pubEmp: qEmp.toLowerCase(), preview: true, token: false, started: false, sent: null, form: {}, errs: {} }); window.scrollTo(0, 0); },
      selTextos: () => this.setState({ qSel: 'textos' }), txBd: qSel === 'textos' ? '#C70602' : '#E4E4E4', isTextos: !SI, isItem: !!SI,
      texts: TX.map(([k, l, big]) => ({ l, v: DR.texts[k], big: !!big, small: !big, on: e => { const v = e.target.value; mutQ(dr => { dr.texts[k] = v; }); } })),
      secs: qeSecs, hCols: ['Versão', 'Publicada em', 'Por', 'O que mudou', 'Perguntas', 'Respostas recebidas'], hist: QZ.hist.map(h => ({ v: String(h.v), at: h.at, by: h.by, nota: h.nota, n: String(h.n), resp: String(nResp(h.v)) })) };
    const doPublish = () => { if ((S.pubNote || '').trim().length < 5) return this.flash('Descreva o que mudou nesta versão.'); const n = this.now(); this.mut(d => { const z = d.qz[qEmp]; z.v += 1; z.at = n; z.by = 'Luiza Martins'; z.pub = JSON.parse(JSON.stringify(z.draft)); z.hist.unshift({ v: z.v, at: n, by: 'Luiza Martins', nota: S.pubNote.trim(), n: z.pub.items.length }); }); this.setState({ modal: null }); this.flash('Versão v' + (QZ.v + 1) + ' publicada em /pesquisa/' + qEmp.toLowerCase() + '.'); };

    const NAV = [['Operação', [['Dashboard'], ['Nova manifestação'], ['Manifestações'], ['Minhas pendências']]], ['Gestão', [['Indicadores'], ['RNC'], ['Central de RCA']]], ['Relacionamento', [['Centro das Pesquisas', 1]]], ['Conhecimento', [['Cérebro'], ['Banco de casos']]]];
    const navG = NAV.map(([l, items]) => ({ l, items: items.map(([x, on]) => ({ l: x, href: on ? '#' : 'AssistenteSAC.dc.html', go: on ? (e => { e.preventDefault(); this.setState({ tab: 'geral' }); }) : undefined, bg: on ? '#FDECEC' : 'transparent', fg: on ? '#A80502' : '#545252', fw: on ? '700' : '500', badge: on && unreadN ? String(unreadN) : '' })) }));
    const base = 'assistentesac.vercel.app';

    return {
      isPub: mode === 'pub', isInt: mode === 'int',
      pubUrl: base + '/pesquisa/' + slug + (S.token ? '/8f72k9' : ''), pubEmps: ['chiacchio', 'plaschio', 'tubahia'].map(x => ({ l: '/' + x, go: () => setPub(x), bg: slug === x ? '#C70602' : 'transparent', bd: slug === x ? '#C70602' : '#555' })),
      tokenLabel: S.token ? 'Usando link individual ✓' : 'Simular link individual', toggleToken: () => { const t = !S.token; this.setState({ token: t, started: false, form: t ? this.prefill(tokenData[slug]) : {}, errs: {}, sent: null }); },
      goInternal: () => { this.setState({ mode: 'int', tab: 'geral' }); window.scrollTo(0, 0); }, goPublic: () => { this.setState({ mode: 'pub', started: false, sent: null, closed: false }); window.scrollTo(0, 0); },
      showWelcome: !S.sent && !S.started, showForm: !S.sent && !!S.started, showThanks: !!S.sent, token: S.token, tokenCli: S.token ? (tokenData[slug] || [])[1] : '', start: () => { this.setState({ started: true }); window.scrollTo(0, 0); }, sentId: S.sent || '', closed: S.closed, notClosed: !S.closed, closeThanks: () => { try { window.close(); } catch (e) { } this.setState({ closed: true }); },
      brand: { l: empName, up: empName.toUpperCase(), logo: { chiacchio: 'assets/logo-chiacchio-embalagens.png', plaschio: 'assets/logo-plaschio.png', tubahia: 'assets/logo-tubahia.png' }[slug], c: slug === 'tubahia' ? '#2B2070' : '#B9171A', soft: slug === 'tubahia' ? '#D9D6F0' : '#FFE1E0' },
      pubSecs, qt, preview: !!S.preview, notPreview: !S.preview, backEditor: () => { this.setState({ mode: 'int', tab: 'quest', preview: false, sent: null, started: false, form: {}, errs: {} }); window.scrollTo(0, 0); }, outroV: fm.outro || '', onOutro: e => setFm('outro', e.target.value), outroBc: er.motivo && fm.motivo === 'Outro' ? '#C70602' : '#D6D6D6', comentV: fm.coment || '', onComent: e => setFm('coment', e.target.value),
      errCount: Object.keys(er).length ? String(Object.keys(er).length) : '', submit: S.submitting ? undefined : submit, submitL: S.submitting ? 'ENVIANDO…' : 'ENVIAR PESQUISA',
      navG, tabs, v, unread: unreadN ? String(unreadN) : '', goNotifs: () => this.setState({ tab: 'notifs' }), openLinks: () => this.setState({ modal: 'links' }),
      needFilters: ['geral', 'empresa', 'coment', 'ocs'].includes(S.tab), fFull: full, fSelects, f: F, onDe: e => setF('de', e.target.value), onAte: e => setF('ate', e.target.value), onCli: e => setF('cli', e.target.value), clearF: () => setF('emp', 'Todas') || this.setState({ f: this.F0() }),
      flowA: ['PESQUISA DE SATISFAÇÃO', 'RESPOSTA DO CLIENTE', 'ANÁLISE DA AVALIAÇÃO', 'NOTA ≤ 6?', 'ANÁLISE DO SAC'].map(l => ({ l })),
      kpis: kpiList(st), countTxt: 'Mostrando ' + shown.length + ' de ' + list.length, cols: ['ID', 'Data e hora', 'Empresa', 'Cliente', 'NPS', 'Qualidade', 'Prazo', 'Atend.', 'Canal', 'Status'], rows: S.loading ? [] : shown.map(row), loading: S.loading, ready: !S.loading, skel: [1, 2, 3, 4, 5, 6], empty: !S.loading && !list.length, more: !S.loading && list.length > S.limit, loadMore: () => this.setState({ limit: S.limit + 40 }),
      tree: years, crumbT: [{ l: String(tr.ano), a: '›' }, { l: K.MN[tr.mes], a: '›' }, { l: tr.emp, a: '' }], tKpis: kpiList(ts).filter(k => ['PESQUISAS RECEBIDAS', 'NPS', 'SATISFAÇÃO MÉDIA', 'NOTAS BAIXAS', 'OCORRÊNCIAS GERADAS', 'MANIFESTAÇÕES GERADAS'].includes(k.l)), cols2: ['ID', 'Data e hora', 'Cliente', 'NPS', 'Qualidade', 'Prazo', 'Atend.', 'Status'], tRows: tl.map(row), tEmpty: !tl.length,
      empCards, dEmpChips: ['Todas'].concat(K.EMP).map(x => chip(S.dEmp === x, x === 'Todas' ? 'Consolidado' : x, () => this.setState({ dEmp: x }))), dPerChips: [['12m', 'Últimos 12 meses'], ['2026', '2026'], ['2025', '2025']].map(([k, l]) => chip(S.dPer === k, l, () => this.setState({ dPer: k }))), charts,
      cChips, coms, cEmpty: !cList.length, cMore: cList.length > S.cLimit, cLoadMore: () => this.setState({ cLimit: S.cLimit + 20 }),
      ocCols: ['Ocorrência', 'Pesquisa', 'Empresa', 'Cliente', 'Pergunta', 'Nota', 'Setor', 'Responsável', 'Prazo', 'Status'], ocRows, ocEmpty: !ocRows.length,
      nChips, notifs, nEmpty: !notifs.length,
      qe, qi, pubNote: S.pubNote || '', onPubNote: e => this.setState({ pubNote: e.target.value }), doPublish,
      dr, dec, setores: K.SETORES, closeDr: () => this.setState({ sel: null }), stop: e => e.stopPropagation(),
      od, closeOd: () => this.setState({ ocSel: null }), md, mv, closeMd: () => this.setState({ modal: null, mvId: null }),
      linkRows: ['chiacchio', 'plaschio', 'tubahia'].map(x => ({ l: K.SLUG[x], url: 'https://' + base + '/pesquisa/' + x, copy: () => { try { navigator.clipboard.writeText('https://' + base + '/pesquisa/' + x); } catch (e) { } this.flash('Link copiado.'); }, open: () => { this.setState({ modal: null, mode: 'pub', pubEmp: x, token: false, started: false, sent: null, form: {}, errs: {} }); window.scrollTo(0, 0); } })),
      toast: S.toast
    };
  }
  prefill(t) { return t ? { email: t[0], razao: t[1], tel: t[2], cnpj: t[3], cep: t[4] } : {}; }
}
</script>
</body>
</html>

````

## Anexo B — mockup RelatorioSatisfacao.dc.html

````html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<title>Relatórios de Satisfação · Grupo Chiacchio</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
<style>
body{margin:0;background:#F4F4F4;color:#1F1F1F;font-family:Montserrat,system-ui,sans-serif;font-size:14px;-webkit-font-smoothing:antialiased}
button,input,select,textarea{font:inherit;color:inherit}button{white-space:nowrap}
a{color:#A80502;text-decoration:none}a:hover{color:#7F0401;text-decoration:underline}
*{box-sizing:border-box}
@media print{[data-noprint]{display:none!important}body{background:#fff}[data-card]{break-inside:avoid}}
</style>
</helmet>
<div style="min-height:100vh;font-family:Montserrat,system-ui,sans-serif;color:#1F1F1F">

  <div data-noprint style="background:#fff;border-bottom:1px solid #E4E4E4;padding:10px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;position:sticky;top:0;z-index:20">
    <img src="assets/simbolo-vermelho.png" alt="" style="width:26px;height:auto">
    <div style="display:flex;flex-direction:column;white-space:nowrap"><span style="font-weight:700;font-size:14px">Relatórios de satisfação</span><span style="font-size:11.5px;color:#929090">{{ topSub }}</span></div>
    <sc-if value="{{ notDir }}"><a href="PesquisaSatisfacao.dc.html" style="font-size:12.5px;font-weight:600;white-space:nowrap">← Centro das Pesquisas</a></sc-if>
    <div style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button onClick="{{ togDir }}" style="display:flex;align-items:center;gap:8px;border:1px solid #D6D6D6;background:#fff;border-radius:8px;padding:7px 12px;cursor:pointer;font-size:12.5px"><span style="width:30px;height:17px;border-radius:99px;padding:2px;display:flex;justify-content:{{ dirJ }};background:{{ dirB }}"><span style="width:13px;height:13px;border-radius:50%;background:#fff"></span></span>Visão da Diretoria</button>
      <button onClick="{{ printPdf }}" style="border:1px solid #1F1F1F;background:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:12.5px;font-weight:600">Baixar PDF</button>
      <sc-if value="{{ notDir }}"><button onClick="{{ openSend }}" style="border:0;background:#C70602;color:#fff;border-radius:8px;padding:9px 14px;cursor:pointer;font-size:12.5px;font-weight:700">Enviar para Diretoria e Presidência</button></sc-if>
    </div>
  </div>

  <div data-noprint style="max-width:1120px;margin:0 auto;padding:16px 20px 0;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
    <div style="display:flex;gap:6px;flex-wrap:wrap"><sc-for list="{{ empChips }}" as="c" hint-placeholder-count="3"><button onClick="{{ c.go }}" style="border:1px solid {{ c.bd }};background:{{ c.bg }};color:{{ c.fg }};border-radius:99px;padding:7px 13px;font-size:12.5px;cursor:pointer;font-weight:600">{{ c.l }}</button></sc-for></div>
    <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:#666464;font-weight:600">Mês de referência<select value="{{ mes }}" onChange="{{ onMes }}" style="height:34px;border:1px solid #D6D6D6;border-radius:7px;padding:0 8px;background:#fff;font-size:12.5px;color:#1F1F1F"><sc-for list="{{ mesOpts }}" as="o"><option value="{{ o.v }}">{{ o.l }}</option></sc-for></select></label>
    <div style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:#666464;font-weight:600">Período<div style="display:flex;gap:4px"><sc-for list="{{ perChips }}" as="c"><button onClick="{{ c.go }}" style="height:34px;border:1px solid {{ c.bd }};background:{{ c.bg }};color:{{ c.fg }};border-radius:7px;padding:0 10px;font-size:12px;cursor:pointer">{{ c.l }}</button></sc-for></div></div>
    <sc-if value="{{ notDir }}"><label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:#666464;font-weight:600">Meta<input type="number" step="0.1" value="{{ meta }}" onChange="{{ onMeta }}" style="height:34px;width:76px;border:1px solid #D6D6D6;border-radius:7px;padding:0 8px;background:#fff;font-size:12.5px"></label></sc-if>
    <span style="font-size:11.5px;color:#929090;flex-basis:100%">{{ nextNote }}</span>
  </div>

  <div style="max-width:1120px;margin:0 auto;padding:16px 20px 60px;display:flex;flex-direction:column;gap:16px">

    <div data-card style="background:#fff;border:1px solid #E4E4E4;border-radius:12px;overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;padding:18px 22px;border-bottom:3px solid {{ brandC }}">
        <sc-if value="{{ hasLogo }}" hint-placeholder-val="{{ false }}"><img src="{{ logo }}" alt="{{ emp }}" style="height:46px;width:auto;max-width:60%;display:block"></sc-if>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="padding:4px 11px;border-radius:99px;font-size:11.5px;font-weight:700;letter-spacing:.03em;white-space:nowrap;background:{{ st.bg }};color:{{ st.fg }}">{{ st.t }}</span><sc-if value="{{ exemplo }}"><span style="padding:4px 11px;border-radius:99px;font-size:11.5px;font-weight:600;white-space:nowrap;background:#EEEEEE;color:#545252">Dados de exemplo</span></sc-if></div>
      </div>
      <div style="padding:20px 22px;display:flex;flex-wrap:wrap;gap:20px;align-items:flex-end;justify-content:space-between">
        <div style="min-width:0"><div style="font-size:11.5px;font-weight:700;letter-spacing:.1em;color:#666464">RELATÓRIO DE PESQUISA DE SATISFAÇÃO DE CLIENTES</div><div style="font-size:26px;font-weight:700;line-height:1.2;margin-top:4px">{{ empUp }} · {{ mesLong }}</div><div style="font-size:12.5px;color:#666464;margin-top:4px">{{ pubLine }}</div></div>
        <div style="border:1.5px solid #1F1F1F;border-radius:10px;padding:10px 18px;text-align:center"><div style="font-size:10.5px;font-weight:700;letter-spacing:.08em;color:#545252;white-space:nowrap">META DE SATISFAÇÃO GERAL</div><div style="font-size:26px;font-weight:700;color:#1E6B3A">≥ {{ metaTxt }}</div></div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px">
      <div data-card style="background:{{ hero.bg }};color:#fff;border-radius:12px;padding:22px 24px;display:flex;flex-direction:column;gap:6px">
        <span style="font-size:11.5px;font-weight:700;letter-spacing:.1em;opacity:.9">INDICADOR DO MÊS</span>
        <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap"><span style="font-size:56px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums">{{ hero.v }}</span><span style="font-size:15px;font-weight:600">{{ hero.delta }}</span></div>
        <span style="font-size:13.5px;font-weight:600">{{ hero.status }}</span>
        <span style="font-size:12.5px;opacity:.92">{{ hero.sub }}</span>
      </div>
      <div data-card style="background:#fff;border:1px solid #E4E4E4;border-radius:12px;padding:18px 20px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 18px">
        <sc-for list="{{ resumo }}" as="r" hint-placeholder-count="4"><div><div style="font-size:11px;font-weight:600;color:#666464">{{ r.l }}</div><div style="font-size:21px;font-weight:700;color:{{ r.c }};font-variant-numeric:tabular-nums">{{ r.v }}</div><div style="font-size:11.5px;color:#929090">{{ r.d }}</div></div></sc-for>
      </div>
    </div>

    <div data-card style="background:#fff;border:1px solid #E4E4E4;border-radius:12px;padding:18px 20px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline"><span style="font-weight:700;font-size:15px">Evolução do indicador</span><span style="font-size:12px;color:#666464">Média de atendimento, prazo, qualidade e recomendação · linha tracejada = meta {{ metaTxt }}</span></div>
      <div style="position:relative;height:220px;display:flex;align-items:flex-end;gap:8px;padding-top:18px">
        <div style="position:absolute;left:0;right:0;bottom:{{ metaLine }};border-top:2px dashed #1F1F1F;opacity:.55"></div>
        
        <sc-for list="{{ bars }}" as="b" hint-placeholder-count="10"><button onClick="{{ b.go }}" style="flex:1;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:4px;border:0;background:none;padding:0;cursor:pointer"><span style="font-size:11px;font-weight:700;color:{{ b.c }};font-variant-numeric:tabular-nums">{{ b.v }}</span><div style="width:100%;max-width:46px;height:{{ b.h }};background:{{ b.c }};border-radius:4px 4px 0 0;opacity:{{ b.op }};outline:{{ b.ol }};outline-offset:2px"></div></button></sc-for>
      </div>
      <div style="display:flex;gap:8px"><sc-for list="{{ bars }}" as="b"><div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:3px"><span style="font-size:11px;font-weight:{{ b.fw }};color:#3A3939;white-space:nowrap">{{ b.l }}</span><div style="width:100%;max-width:46px;height:30px;display:flex;align-items:flex-end"><div style="width:100%;height:{{ b.nh }};background:#D6D6D6;border-radius:3px 3px 0 0"></div></div><span style="font-size:10.5px;color:#929090;white-space:nowrap">{{ b.n }}</span></div></sc-for></div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:12px">
      <sc-for list="{{ crit }}" as="k" hint-placeholder-count="4">
        <div data-card style="background:#fff;border:1px solid #E4E4E4;border-top:3px solid {{ k.c }};border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:6px">
          <span style="font-size:11.5px;font-weight:700;letter-spacing:.06em;color:#545252">{{ k.l }}</span>
          <div style="display:flex;align-items:baseline;gap:8px"><span style="font-size:30px;font-weight:700;font-variant-numeric:tabular-nums">{{ k.v }}</span><span style="font-size:13px;font-weight:700;color:{{ k.dc }}">{{ k.d }}</span></div>
          <span style="font-size:12px;color:{{ k.c }};font-weight:600">{{ k.s }}</span>
          <div style="display:flex;align-items:flex-end;gap:3px;height:38px;margin-top:4px"><sc-for list="{{ k.spark }}" as="x"><div title="{{ x.t }}" style="flex:1;height:{{ x.h }};background:{{ x.c }};border-radius:2px 2px 0 0;opacity:{{ x.op }}"></div></sc-for></div>
        </div>
      </sc-for>
    </div>

    <div data-card style="background:#fff;border:1px solid #E4E4E4;border-radius:12px;overflow:hidden">
      <div style="padding:14px 18px;border-bottom:1px solid #EFEFEF;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><span style="font-weight:700;font-size:15px">Resultado mensal</span><div style="display:flex;gap:10px;font-size:11.5px;color:#545252;align-items:center"><span style="display:flex;gap:4px;align-items:center;white-space:nowrap"><span style="width:12px;height:12px;border-radius:3px;background:#E6F2EA"></span>na meta</span><span style="display:flex;gap:4px;align-items:center;white-space:nowrap"><span style="width:12px;height:12px;border-radius:3px;background:#FBF0D9"></span>7 a meta</span><span style="display:flex;gap:4px;align-items:center;white-space:nowrap"><span style="width:12px;height:12px;border-radius:3px;background:#FDECEC"></span>abaixo de 7</span></div></div>
      <div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;min-width:720px;font-size:13px">
        <thead><tr style="background:#FAFAFA"><sc-for list="{{ tCols }}" as="c"><th style="text-align:center;font-weight:600;font-size:11.5px;color:#666464;padding:9px 10px;border-bottom:1px solid #E4E4E4;white-space:nowrap">{{ c }}</th></sc-for></tr></thead>
        <tbody><sc-for list="{{ tRows }}" as="r" hint-placeholder-count="10"><tr style="border-bottom:1px solid #EFEFEF;background:{{ r.rb }}"><td style="padding:8px 12px;font-weight:700;white-space:nowrap;text-align:center">{{ r.l }}</td><sc-for list="{{ r.c }}" as="x"><td style="padding:5px 6px;text-align:center"><span style="display:inline-block;min-width:54px;padding:5px 8px;border-radius:6px;background:{{ x.bg }};color:{{ x.fg }};font-weight:{{ x.fw }};font-variant-numeric:tabular-nums">{{ x.v }}</span></td></sc-for><td style="padding:8px 12px;text-align:center;color:#545252;font-variant-numeric:tabular-nums">{{ r.n }}</td></tr></sc-for></tbody>
      </table></div>
    </div>

    <sc-for list="{{ secs }}" as="s" hint-placeholder-count="5">
      <div data-card style="background:#fff;border:1px solid #E4E4E4;border-radius:12px;padding:18px 20px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><span style="font-weight:700;font-size:15px">{{ s.t }}</span><div data-noprint style="display:flex;gap:8px;align-items:center"><span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;background:{{ s.src.bg }};color:{{ s.src.fg }}">{{ s.src.t }}</span><sc-if value="{{ s.canEdit }}"><button onClick="{{ s.edit }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px">Editar texto</button></sc-if></div></div>
        <sc-if value="{{ s.editing }}">
          <textarea rows="7" value="{{ editV }}" onChange="{{ onEditV }}" style="border:1px solid #D6D6D6;border-radius:8px;padding:10px 12px;font-size:13.5px;line-height:1.6;resize:vertical;background:#fff"></textarea>
          <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button onClick="{{ s.regen }}" style="border:0;background:none;color:#A80502;cursor:pointer;font-size:12.5px;font-weight:600;margin-right:auto">Restaurar texto gerado pelos dados</button><button onClick="{{ cancelEdit }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:7px;padding:7px 12px;cursor:pointer;font-size:12.5px">Cancelar</button><button onClick="{{ saveEdit }}" style="border:0;background:#1F1F1F;color:#fff;border-radius:7px;padding:7px 14px;cursor:pointer;font-size:12.5px;font-weight:600">Salvar</button></div>
        </sc-if>
        <sc-if value="{{ s.view }}"><sc-for list="{{ s.ps }}" as="p"><p style="margin:0;font-size:14px;line-height:1.65;color:#2B2A2A;text-wrap:pretty">{{ p }}</p></sc-for></sc-if>
      </div>
    </sc-for>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:16px">
      <div data-card style="background:#fff;border:1px solid #E4E4E4;border-radius:12px;padding:18px 20px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;justify-content:space-between;gap:4px 8px;flex-wrap:wrap;align-items:baseline"><span style="font-weight:700;font-size:15px">Motivo da compra</span><span style="font-size:11.5px;color:#929090;white-space:nowrap">{{ motivoSub }}</span></div>
        <sc-if value="{{ hasMotivo }}"><sc-for list="{{ motivos }}" as="m"><div style="display:grid;grid-template-columns:150px minmax(0,1fr) 34px;gap:10px;align-items:center;font-size:13px"><span>{{ m.l }}</span><div style="height:10px;background:#F4F4F4;border-radius:5px;overflow:hidden"><div style="height:100%;width:{{ m.w }};background:{{ brandC }}"></div></div><span style="text-align:right;font-weight:700;font-variant-numeric:tabular-nums">{{ m.n }}</span></div></sc-for></sc-if>
        <sc-if value="{{ noMotivo }}"><span style="font-size:13px;color:#666464">A pergunta sobre motivo da compra passou a ser feita em julho/2026.</span></sc-if>
      </div>
      <div data-card style="background:#fff;border:1px solid #E4E4E4;border-radius:12px;padding:18px 20px;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;justify-content:space-between;gap:4px 8px;flex-wrap:wrap;align-items:baseline"><span style="font-weight:700;font-size:15px;white-space:nowrap">Notas baixas e tratativas</span><a data-noprint href="PesquisaSatisfacao.dc.html" style="font-size:12px;font-weight:600;white-space:nowrap">Abrir no Centro das Pesquisas</a></div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px"><sc-for list="{{ trat }}" as="t"><div style="background:#FAFAFA;border-radius:9px;padding:10px 12px"><div style="font-size:11px;font-weight:600;color:#666464">{{ t.l }}</div><div style="font-size:22px;font-weight:700;color:{{ t.c }}">{{ t.v }}</div></div></sc-for></div>
        <span style="font-size:12px;color:#666464;line-height:1.5">Nota ≤ 6 é sinalizada para análise do SAC; ocorrência e manifestação formal são decisões do SAC.</span>
      </div>
    </div>

    <div data-card style="background:#fff;border:1px solid #E4E4E4;border-radius:12px;overflow:hidden">
      <div style="padding:14px 18px;border-bottom:1px solid #EFEFEF;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><span style="font-weight:700;font-size:15px">Análise mensal dos resultados</span><button data-noprint onClick="{{ togAll }}" style="border:0;background:none;color:#A80502;cursor:pointer;font-size:12.5px;font-weight:600">{{ allL }}</button></div>
      <sc-for list="{{ hist }}" as="h" hint-placeholder-count="6">
        <div style="border-bottom:1px solid #EFEFEF">
          <button onClick="{{ h.go }}" style="width:100%;display:flex;gap:12px;align-items:center;border:0;background:{{ h.bg }};padding:12px 18px;cursor:pointer;text-align:left;white-space:normal"><span style="font-weight:700;font-size:13.5px;min-width:70px">{{ h.l }}</span><span style="font-weight:700;font-size:13.5px;color:{{ h.c }};white-space:nowrap">Indicador {{ h.v }}</span><span style="font-size:12px;color:#929090;white-space:nowrap">{{ h.n }} respostas</span><span style="margin-left:auto;color:#929090">{{ h.sign }}</span></button>
          <sc-if value="{{ h.open }}"><div style="padding:0 18px 14px;display:flex;flex-direction:column;gap:8px"><sc-for list="{{ h.ps }}" as="p"><p style="margin:0;font-size:13.5px;line-height:1.65;color:#2B2A2A">{{ p }}</p></sc-for></div></sc-if>
        </div>
      </sc-for>
    </div>

    <sc-if value="{{ notDir }}">
    <div data-noprint style="background:#fff;border:1px solid #E4E4E4;border-radius:12px;overflow:hidden">
      <div style="padding:14px 18px;border-bottom:1px solid #EFEFEF;font-weight:700;font-size:15px">Envios deste relatório</div>
      <sc-for list="{{ envios }}" as="e"><div style="display:grid;grid-template-columns:140px minmax(0,1fr) 150px;gap:12px;padding:10px 18px;border-bottom:1px solid #EFEFEF;font-size:12.5px;align-items:center"><span style="color:#666464">{{ e.at }}</span><span>{{ e.to }}</span><span style="color:#666464">{{ e.views }}</span></div></sc-for>
      <sc-if value="{{ noEnvios }}"><div style="padding:16px 18px;font-size:12.5px;color:#929090">Ainda não enviado. Revise os textos e use “Enviar para Diretoria e Presidência”.</div></sc-if>
    </div>
    </sc-if>
  </div>

  <sc-if value="{{ sendOpen }}">
  <div data-noprint style="position:fixed;inset:0;background:rgba(20,20,20,.5);z-index:60;display:grid;place-items:center;padding:20px">
    <div style="width:min(560px,100%);background:#fff;border-radius:12px;overflow:hidden">
      <div style="padding:16px 20px;border-bottom:1px solid #E4E4E4"><div style="font-weight:700;font-size:17px">Enviar relatório · {{ empUp }} · {{ mesLong }}</div><div style="font-size:12.5px;color:#666464">Os destinatários recebem um link de leitura que sempre mostra os dados atualizados.</div></div>
      <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;flex-direction:column;gap:6px"><span style="font-size:12px;font-weight:600;color:#545252">Destinatários</span><div style="display:flex;gap:6px;flex-wrap:wrap"><sc-for list="{{ destChips }}" as="c"><button onClick="{{ c.go }}" style="border:1px solid {{ c.bd }};background:{{ c.bg }};color:{{ c.fg }};border-radius:99px;padding:6px 12px;font-size:12.5px;cursor:pointer">{{ c.l }}</button></sc-for></div></div>
        <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:600;color:#545252">Mensagem<textarea rows="4" value="{{ sendMsg }}" onChange="{{ onSendMsg }}" style="border:1px solid #D6D6D6;border-radius:8px;padding:10px 12px;font-size:13.5px;font-weight:400;line-height:1.5;resize:vertical;background:#fff;color:#1F1F1F"></textarea></label>
        <div style="display:flex;gap:8px;align-items:center;background:#F4F4F4;border-radius:8px;padding:9px 12px;font-size:12px"><span style="font-family:ui-monospace,monospace;flex:1;min-width:0;overflow-wrap:anywhere">{{ shareUrl }}</span><button onClick="{{ copyUrl }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px">Copiar</button></div>
        <button onClick="{{ togPdf }}" style="display:flex;align-items:center;gap:10px;border:0;background:none;padding:0;cursor:pointer;font-size:13px;text-align:left"><span style="width:34px;height:19px;border-radius:99px;padding:2px;display:flex;justify-content:{{ pdfJ }};background:{{ pdfB }}"><span style="width:15px;height:15px;border-radius:50%;background:#fff"></span></span>Anexar também o PDF do mês</button>
      </div>
      <div style="padding:12px 20px 18px;display:flex;justify-content:flex-end;gap:8px"><button onClick="{{ closeSend }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:8px;padding:9px 16px;cursor:pointer;font-size:13px">Cancelar</button><button onClick="{{ doSend }}" style="border:0;background:#C70602;color:#fff;border-radius:8px;padding:9px 18px;cursor:pointer;font-size:13px;font-weight:700">Publicar e enviar</button></div>
    </div>
  </div>
  </sc-if>
  <sc-if value="{{ toast }}"><div data-noprint style="position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#1F1F1F;color:#fff;padding:11px 16px;border-radius:8px;font-size:13px;z-index:90;max-width:92vw">{{ toast }}</div></sc-if>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props="{&quot;visao&quot;:{&quot;editor&quot;:&quot;enum&quot;,&quot;options&quot;:[&quot;SAC&quot;,&quot;Diretoria&quot;],&quot;default&quot;:&quot;SAC&quot;,&quot;tsType&quot;:&quot;string&quot;}}">
class Component extends DCLogic {
  state = { db: null, emp: 'Chiacchio', mes: '2026-08', per: 'all', meta: 8.5, dir: false, editKey: null, editV: '', openM: null, allOpen: false, send: false, dest: ['Diretoria', 'Presidência'], sendMsg: '', pdf: true, toast: '' };

  componentDidMount() {
    let db = null; try { db = JSON.parse(localStorage.getItem('gc-relatorios-v1') || 'null'); } catch (e) { }
    if (!db) db = { texts: {}, status: { 'Chiacchio|2026-07': { t: 'Publicado', at: '05/08/2026 10:12', by: 'Luiza Martins' } }, envios: { 'Chiacchio|2026-07': [{ at: '05/08/2026 10:12', to: 'Diretoria, Presidência · com PDF', views: 'visualizado por 3' }] } };
    const dir = /dir=1/.test(location.search) || this.props.visao === 'Diretoria';
    this.setState({ db, dir });
  }
  save(db) { try { localStorage.setItem('gc-relatorios-v1', JSON.stringify(db)); } catch (e) { } }
  flash(t) { this.setState({ toast: t }); clearTimeout(this._t); this._t = setTimeout(() => this.setState({ toast: '' }), 2800); }
  now() { const d = new Date(), p = n => String(n).padStart(2, '0'); return '02/10/2026 ' + p(d.getHours()) + ':' + p(d.getMinutes()); }

  data() {
    const MK = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
    const chi = [[8.55, 6.4, 9.6, 8.55, 20], [7.66, 6.66, 9.66, 7.5, 6], [9.2, 5.4, 8.6, 7.4, 5], [8.3, 5.6, 8.3, 8.3, 3], [7.0, 6.0, 10, 7.75, 4], [9.08, 7.88, 9.38, 8.69, 37], [9.19, 8.91, 9.19, 9.28, 46], [9.06, 8.75, 9.31, 9.06, 32], [9.22, 8.5, 8.31, 8.45, 21], [9.5, 9.15, 9.1, 9.1, 20]];
    let sd = 5; const rnd = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    const gen = (b) => MK.map((k, i) => { const t = b + i * 0.09; const r = x => Math.round(Math.min(10, Math.max(5, x)) * 100) / 100; return [r(t + 0.3 + (rnd() - 0.5) * 0.9), r(t - 0.6 + (rnd() - 0.5) * 1.2), r(t + 0.4 + (rnd() - 0.5) * 0.8), r(t + (rnd() - 0.5) * 0.9), 6 + Math.floor(i * 2.6 + rnd() * 8)]; });
    const D = { Chiacchio: chi, Plaschio: gen(7.6), Tubahia: gen(7.9) };
    const out = {}; Object.keys(D).forEach(e => { out[e] = {}; D[e].forEach((r, i) => { const ind = Math.round((r[0] + r[1] + r[2] + r[3]) / 4 * 100) / 100; out[e][MK[i]] = { at: r[0], pr: r[1], qu: r[2], re: r[3], n: r[4], ind: e === 'Chiacchio' ? [8.27, 7.87, 7.65, 7.62, 7.69, 8.75, 9.14, 9.05, 8.62, 9.21][i] : ind }; }); });
    return { MK, S: out };
  }
  seedTexts() {
    return {
      'Chiacchio|2026-08|desempenho': 'Após a redução observada em julho, a Chiacchio Embalagens apresentou em agosto uma recuperação no indicador, que passou de 8,62 para 9,21. O resultado ficou acima da meta estabelecida de 8,5 e representa o melhor resultado registrado no período.\nA recuperação foi observada em todos os critérios avaliados. O atendimento passou de 9,22 para 9,50, o prazo de entrega de 8,50 para 9,15, a qualidade de 8,31 para 9,10 e a recomendação de 8,45 para 9,10.\nO resultado demonstra uma retomada principalmente nos critérios que haviam apresentado maior redução em julho, especialmente qualidade e recomendação. Dessa forma, o desempenho de agosto reforça a evolução observada nos últimos meses e indica que a queda registrada em julho não se manteve no mês seguinte.',
      'Chiacchio|2026-07|critica': 'O resultado de julho mostra uma redução em relação aos dois meses anteriores, principalmente pela queda observada nos critérios de qualidade e recomendação. Apesar disso, o indicador geral permaneceu acima da meta, o que demonstra que a evolução conquistada nos últimos meses ainda está presente.\nA queda na qualidade merece maior atenção, já que esse critério vinha apresentando resultados elevados e foi o que teve a maior variação no mês. A redução da recomendação também deve ser acompanhada, principalmente para entender se está relacionada à percepção sobre a qualidade ou a outros aspectos da experiência do cliente.\nPor outro lado, o atendimento apresentou melhora, passando de 9,06 para 9,22, e o prazo de entrega se manteve exatamente na meta, com 8,50. Isso indica que nem todos os aspectos da experiência apresentaram piora no mês.',
      'Chiacchio|2026-07|fortes': 'A Chiacchio mantém uma percepção positiva dos clientes, mesmo com a redução do indicador geral em julho. O resultado de 8,62 permaneceu acima da meta de 8,5, mantendo a empresa pelo quarto mês consecutivo dentro do resultado esperado.\nO atendimento foi o principal destaque do mês, alcançando 9,22 e apresentando melhora em relação a junho. O resultado reforça a boa percepção dos clientes em relação ao atendimento realizado pela equipe e pelos representantes.\nO prazo de entrega também se manteve dentro da meta, com 8,50, e continua apresentando uma evolução importante quando comparado aos primeiros meses do período, quando era um dos principais pontos de atenção.\nAlém disso, a pesquisa continua proporcionando uma base maior para entender a percepção dos clientes. Mesmo com a redução para 21 respostas em julho, o volume permaneceu dentro da meta estabelecida, permitindo a continuidade do acompanhamento dos indicadores.',
      'Chiacchio|2026-07|oport': 'A qualidade passa a ser o principal ponto de atenção em julho, apresentando uma redução mais significativa em relação ao mês anterior, de 9,31 para 8,31. É importante acompanhar as avaliações e os comentários relacionados a esse critério para identificar possíveis causas e verificar se a redução representa uma situação pontual ou uma tendência.\nA recomendação também apresentou queda, passando de 9,06 para 8,45. Como esse indicador está diretamente relacionado à percepção geral do cliente, vale acompanhar sua evolução nos próximos meses e entender quais fatores podem estar influenciando essa redução.\nO prazo de entrega, apesar de ter permanecido dentro da meta, continua sendo um ponto que merece acompanhamento. O indicador ficou em 8,50, exatamente no limite da meta, portanto é importante evitar uma nova redução e manter a evolução conquistada desde os primeiros meses do período.',
      'Chiacchio|2026-07|acoes': 'Acompanhar mais de perto o indicador de qualidade, principalmente nos próximos meses, buscando identificar se a redução observada em julho está relacionada a alguma ocorrência específica ou se existe algum padrão recorrente nas avaliações dos clientes.\nManter o acompanhamento da recomendação, avaliando sua evolução junto aos demais critérios para entender os principais fatores que podem estar influenciando a percepção geral dos clientes.\nDar continuidade ao acompanhamento do prazo de entrega, buscando evitar nova redução, já que o indicador atingiu exatamente a meta de 8,5 em julho.\nManter o acompanhamento dos atendimentos realizados pelos RCA, em conjunto com a Gerência Comercial, principalmente nos casos que envolvam reclamações ou situações que possam impactar a experiência do cliente.',
      'Chiacchio|2026-07|motivo': 'O novo questionamento também começa a trazer informações relevantes sobre a percepção dos clientes. Em julho, a qualidade aparece como o principal motivo identificado, além de respostas relacionadas ao preço, atendimento, proximidade do vendedor, desempenho da marca frente a outras opções e experiências anteriores com as embalagens.\nComo essa pergunta ainda está em fase de consolidação, a continuidade da coleta nos próximos meses será importante para identificar quais desses fatores aparecem de forma recorrente e, assim, entender melhor o que influencia a decisão de compra dos clientes.'
    };
  }
  monthTexts() {
    return {
      '2025-11': 'O período começa com um resultado próximo da meta e com a melhor base de respostas entre os primeiros meses analisados, totalizando 20 participações. Atendimento, qualidade e recomendação apresentaram bons resultados, com notas de 8,55, 9,6 e 8,55, respectivamente. O prazo já aparecia como principal ponto de atenção, com nota 6,4, mas ainda sem comprometer tanto o resultado geral.',
      '2025-12': 'Em dezembro, houve uma queda no indicador, principalmente nas notas de recomendação (7,5) e atendimento (7,66). A qualidade, por outro lado, continuou com um resultado muito positivo, chegando a 9,66. O mês contou com apenas 6 respostas, o que também precisa ser considerado na análise, já que, com uma base pequena, poucas avaliações mais críticas conseguem impactar bastante o resultado.',
      '2026-01': 'Janeiro apresentou a pior nota de prazo de todo o período, com 5,4, além de uma recomendação também abaixo do esperado, com 7,4. Em contrapartida, o atendimento chegou a 9,2, o melhor resultado até aquele momento. Esse contraste mostra que, apesar da boa percepção em relação ao atendimento, o prazo de entrega impactava negativamente a experiência do cliente. A base continuou pequena, com apenas 5 respostas.',
      '2026-02': 'Fevereiro registrou o menor indicador do período. O prazo continuou sendo o principal ponto de atenção, com nota 5,6, puxando o resultado geral para baixo. O mês teve apenas 3 respostas, a menor base de todo o período, o que torna esse resultado mais sensível ao impacto de cada avaliação individual.',
      '2026-03': 'Março foi um mês de resultados bem diferentes entre os critérios avaliados. A qualidade atingiu nota máxima, com 10,0, enquanto o atendimento caiu para 7,0, o menor resultado do período. O prazo também continuou abaixo do esperado, com nota 6,0. O indicador permaneceu abaixo da meta e a base de respostas ainda era pequena, com apenas 4 participações.',
      '2026-04': 'Abril marca uma mudança importante no cenário. Pela primeira vez no período, o indicador ultrapassou a meta de 8,5. A principal evolução aconteceu no prazo, que passou de 6,0 para 7,88. Atendimento (9,08), qualidade (9,38) e recomendação (8,69) também apresentaram bons resultados.\nOutro ponto importante foi o crescimento da base, que chegou a 37 respostas. Esse aumento está relacionado ao processo de estruturação do SAC, que vem sendo conduzido e acompanhado por mim, com uma organização maior dos processos e um acompanhamento mais próximo das pesquisas de satisfação. Com isso, o resultado do mês passa a ter uma base muito mais representativa da percepção dos clientes.',
      '2026-05': 'Maio confirma a evolução iniciada no mês anterior e apresenta o melhor resultado de todo o período. O prazo, que vinha sendo o principal ponto de atenção, chegou a 8,91 e também ultrapassou a meta. A recomendação atingiu 9,28 e o atendimento, 9,19.\nA base de respostas também cresceu novamente, chegando a 46 participações, o maior número do período. Além de reforçar o avanço do trabalho de estruturação e acompanhamento do SAC, esse volume maior de respostas dá mais consistência ao resultado e mostra que a melhora observada em abril não foi isolada, mas se manteve no mês seguinte.',
      '2026-06': 'Junho manteve o bom desempenho observado nos dois meses anteriores e encerrou o período com indicador de 9,05, permanecendo acima da meta estabelecida de 8,5. Embora tenha apresentado uma pequena redução em relação a maio, todos os critérios permaneceram em níveis elevados. A qualidade obteve a melhor avaliação do mês (9,31), seguida pelo atendimento e pela recomendação, ambos com 9,06. O prazo de entrega registrou 8,75, mantendo um desempenho positivo e superior aos resultados apresentados nos primeiros meses do período.',
      '2026-07': 'Julho apresentou uma pequena redução em relação ao mês anterior, com indicador de 8,62, mas ainda permaneceu acima da meta estabelecida de 8,5. O atendimento apresentou melhora, passando para 9,22, enquanto o prazo de entrega se manteve em 8,50.\nA principal redução ocorreu na qualidade, que passou de 9,31 em junho para 8,31, e na recomendação, que passou de 9,06 para 8,45. Apesar da queda nesses critérios, o resultado geral ainda se mantém acima dos indicadores registrados no início do período.',
      '2026-08': 'Agosto apresentou uma recuperação significativa em relação ao mês anterior, com indicador de 9,21, superando a meta de 8,5 e alcançando o melhor resultado registrado no período. Todos os critérios apresentaram evolução. O atendimento alcançou 9,50, o prazo de entrega chegou a 9,15, a qualidade apresentou nota 9,10 e a recomendação também ficou em 9,10.\nO resultado demonstra uma melhora principalmente nos critérios que haviam apresentado redução em julho, indicando uma recuperação na percepção dos clientes em relação à experiência com a empresa.'
    };
  }

  renderVals() {
    const S = this.state;
    if (!S.db) return { empChips: [], bars: [], crit: [], secs: [], hist: [], tRows: [], st: {}, hero: {}, resumo: [], logo: 'assets/logo-chiacchio-embalagens.png', brandC: '#B9171A', empUp: 'CHIACCHIO EMBALAGENS', mesLong: 'Agosto/2026', metaTxt: '8,5', topSub: '', emp: 'Chiacchio', pubLine: '', motivoSub: '', nextNote: '', mesOpts: [], perChips: [], tCols: [], motivos: [], trat: [], envios: [], destChips: [] };
    const { MK, S: DS } = this.data();
    const MS = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'], MN = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const ml = k => MS[+k.slice(5)] + '/' + k.slice(2, 4), mlong = k => MN[+k.slice(5)].replace(/^./, c => c.toUpperCase()) + '/' + k.slice(0, 4), mword = k => MN[+k.slice(5)];
    const f2 = v => v == null ? '—' : v.toFixed(2).replace('.', ','), meta = Number(S.meta) || 8.5, metaTxt = String(meta).replace('.', ',');
    const emp = S.emp, ser = DS[emp], avail = MK.filter(k => ser[k]);
    const ref = avail.includes(S.mes) ? S.mes : avail[avail.length - 1], ri = avail.indexOf(ref);
    const per = S.per === '6' ? avail.slice(Math.max(0, ri - 5), ri + 1) : S.per === '12' ? avail.slice(Math.max(0, ri - 11), ri + 1) : avail.slice(0, ri + 1);
    const cur = ser[ref], prev = ri > 0 ? ser[avail[ri - 1]] : null;
    const GREEN = '#1E6B3A', RED = '#C70602', AMB = '#B07A12';
    const col = v => v >= meta ? GREEN : v >= 7 ? AMB : RED;
    const cell = v => v >= meta ? ['#E6F2EA', '#1E6B3A'] : v >= 7 ? ['#FBF0D9', '#7A4C00'] : ['#FDECEC', '#A80502'];
    const sgn = d => (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d).toFixed(2).replace('.', ',');
    const key = (k, s) => emp + '|' + k + '|' + s;
    const statusO = S.db.status[emp + '|' + ref];
    const brand = { Chiacchio: ['assets/logo-chiacchio-embalagens.png', '#B9171A'], Plaschio: ['assets/logo-plaschio.png', '#B9171A'], Tubahia: ['assets/logo-tubahia.png', '#2B2070'] }[emp];

    // resumo
    const inds = per.map(k => ser[k].ind), avg = inds.reduce((a, b) => a + b, 0) / inds.length;
    const bestK = per.reduce((a, k) => ser[k].ind > ser[a].ind ? k : a, per[0]), worstK = per.reduce((a, k) => ser[k].ind < ser[a].ind ? k : a, per[0]);
    let streak = 0; for (let i = ri; i >= 0 && ser[avail[i]].ind >= meta; i--) streak++;
    const total = per.reduce((a, k) => a + ser[k].n, 0);
    const above = cur.ind >= meta;
    const hero = { v: f2(cur.ind), bg: above ? GREEN : RED, delta: prev ? sgn(cur.ind - prev.ind) + ' vs ' + ml(avail[ri - 1]) : '', status: above ? 'Acima da meta de ' + metaTxt + (streak > 1 ? ' · ' + streak + 'º mês consecutivo' : '') : 'Abaixo da meta de ' + metaTxt + ' · faltam ' + (meta - cur.ind).toFixed(2).replace('.', ','), sub: cur.n + ' respostas em ' + mword(ref) + (cur.n < 10 ? ' · base pequena, resultado sensível a poucas avaliações' : '') };
    const resumo = [{ l: 'Média do indicador no período', v: f2(avg), d: ml(per[0]) + ' a ' + ml(ref), c: '#1F1F1F' }, { l: 'Melhor resultado', v: f2(ser[bestK].ind), d: ml(bestK), c: GREEN }, { l: 'Pior resultado', v: f2(ser[worstK].ind), d: ml(worstK), c: RED }, { l: 'Total de respostas no período', v: String(total), d: per.length + ' meses', c: '#1F1F1F' }];

    // chart: scale 5..10
    const sc = v => Math.max(2, (v - 5) / 5 * 100);
    const nMax = Math.max(...per.map(k => ser[k].n));
    const bars = per.map(k => { const r = ser[k], on = k === ref; return { l: ml(k), v: f2(r.ind), h: sc(r.ind) + '%', c: col(r.ind), op: on ? '1' : '0.72', ol: on ? '2px solid ' + col(r.ind) : 'none', fw: on ? '700' : '500', n: String(r.n), nh: Math.max(6, r.n / nMax * 100) + '%', go: () => this.setState({ mes: k, openM: k }) }; });
    const metaLine = 'calc(' + sc(meta) + '% * 202 / 220)';

    // criteria
    const CR = [['ATENDIMENTO', 'at'], ['PRAZO DE ENTREGA', 'pr'], ['QUALIDADE', 'qu'], ['RECOMENDAÇÃO', 're']];
    const crit = CR.map(([l, k]) => { const v = cur[k], d = prev ? v - prev[k] : 0; return { l, v: f2(v), d: prev ? sgn(d) : '', dc: d > 0.005 ? GREEN : d < -0.005 ? RED : '#666464', c: col(v), s: v >= meta ? 'Dentro da meta' : 'Abaixo da meta', spark: per.map(m => ({ h: sc(ser[m][k]) + '%', c: col(ser[m][k]), op: m === ref ? '1' : '0.55', t: ml(m) + ': ' + f2(ser[m][k]) })) }; });

    // table
    const tCols = ['Mês', 'Atendimento', 'Prazo de entrega', 'Qualidade', 'Recomendação', 'Indicador', 'Respostas'];
    const tRows = per.slice().reverse().map(k => { const r = ser[k]; return { l: ml(k), rb: k === ref ? '#FFF8F8' : '#fff', n: String(r.n), c: [r.at, r.pr, r.qu, r.re, r.ind].map((v, i) => { const cc = cell(v); return { v: f2(v), bg: cc[0], fg: cc[1], fw: i === 4 ? '700' : '500' }; }) }; });

    // auto texts
    const names = { at: 'atendimento', pr: 'prazo de entrega', qu: 'qualidade', re: 'recomendação' };
    const ch = CR.map(([, k]) => ({ k, v: cur[k], d: prev ? cur[k] - prev[k] : 0 }));
    const auto = {
      desempenho: () => { const p = []; p.push(mlong(ref).replace('/', ' de ') + ' registrou indicador de ' + f2(cur.ind) + (prev ? ', ' + (cur.ind >= prev.ind ? 'acima' : 'abaixo') + ' do mês anterior (' + f2(prev.ind) + ')' : '') + ', ' + (above ? 'acima' : 'abaixo') + ' da meta de ' + metaTxt + '.' + (ref === bestK ? ' É o melhor resultado do período analisado.' : ref === worstK ? ' É o menor resultado do período analisado.' : '')); if (prev) { const up = ch.filter(x => x.d > 0.005), dn = ch.filter(x => x.d < -0.005); p.push((up.length ? 'Evoluíram: ' + up.map(x => names[x.k] + ' (' + f2(prev[x.k]) + ' → ' + f2(x.v) + ')').join(', ') + '. ' : '') + (dn.length ? 'Recuaram: ' + dn.map(x => names[x.k] + ' (' + f2(prev[x.k]) + ' → ' + f2(x.v) + ')').join(', ') + '.' : 'Nenhum critério recuou.')); } p.push('O mês teve ' + cur.n + ' respostas' + (cur.n < 10 ? ', uma base pequena: poucas avaliações podem mudar bastante o resultado.' : '.')); return p.join('\n'); },
      critica: () => { const w = ch.slice().sort((a, b) => a.d - b.d)[0], b = ch.slice().sort((a, b) => b.d - a.d)[0]; return (prev ? (w.d >= 0 ? 'Todos os critérios evoluíram em relação ao mês anterior. O maior avanço foi em ' + names[b.k] + ' (' + sgn(b.d) + ') e o menor em ' + names[w.k] + ' (' + sgn(w.d) + '). ' : b.d <= 0 ? 'Todos os critérios recuaram ou ficaram estáveis. A maior queda foi em ' + names[w.k] + ' (' + sgn(w.d) + '). ' : 'A maior queda foi em ' + names[w.k] + ' (' + sgn(w.d) + ') e o maior avanço em ' + names[b.k] + ' (' + sgn(b.d) + '). ') : '') + (above ? 'Mesmo assim, o indicador geral segue dentro da meta.' : 'O indicador geral está abaixo da meta e precisa de acompanhamento mais próximo.') + (ch.filter(x => x.v < meta).length ? '\nCritérios abaixo da meta: ' + ch.filter(x => x.v < meta).map(x => names[x.k] + ' (' + f2(x.v) + ')').join(', ') + '.' : '\nTodos os critérios estão dentro da meta.'); },
      fortes: () => ch.filter(x => x.v >= meta).sort((a, b) => b.v - a.v).map(x => names[x.k].replace(/^./, c => c.toUpperCase()) + ' com ' + f2(x.v) + (prev ? ' (' + sgn(x.d) + ' vs ' + ml(avail[ri - 1]) + ')' : '') + ', dentro da meta.').join('\n') || 'Nenhum critério atingiu a meta neste mês.',
      oport: () => { const l = ch.filter(x => x.v < meta || x.d < -0.3).sort((a, b) => a.v - b.v); return l.length ? l.map(x => names[x.k].replace(/^./, c => c.toUpperCase()) + ' com ' + f2(x.v) + (x.v < meta ? ', abaixo da meta' : '') + (x.d < -0.3 ? ', queda de ' + Math.abs(x.d).toFixed(2).replace('.', ',') + ' em relação ao mês anterior' : '') + '.').join('\n') : 'Sem critérios abaixo da meta ou com queda relevante. Manter o acompanhamento para preservar o resultado.'; },
      acoes: () => { const A = { pr: 'Acompanhar com a Logística as entregas do mês e as notas baixas de prazo registradas no Centro das Pesquisas.', qu: 'Acompanhar com a Qualidade as avaliações e comentários sobre produto para identificar se há ocorrência específica ou padrão recorrente.', at: 'Manter o acompanhamento dos atendimentos realizados pelos RCA, em conjunto com a Gerência Comercial.', re: 'Acompanhar a recomendação junto aos demais critérios para entender o que influencia a percepção geral dos clientes.' }; const l = ch.filter(x => x.v < meta || x.d < -0.3).map(x => A[x.k]); if (cur.n < 10) l.push('Ampliar a base de respostas, reforçando o envio da pesquisa por WhatsApp e e-mail.'); return (l.length ? l : ['Manter o acompanhamento mensal dos quatro critérios e das notas baixas registradas no Centro das Pesquisas.']).join('\n'); }
    };
    const seedT = this.seedTexts();
    const SEC = [['desempenho', 'Desempenho geral'], ['critica', 'Análise crítica dos resultados'], ['fortes', 'Pontos fortes'], ['oport', 'Oportunidades de melhoria'], ['acoes', 'Ações recomendadas']];
    const textOf = s => { const kk = key(ref, s), st = S.db.texts[kk]; if (st) return { t: st.t, src: { t: 'Texto do analista · ' + st.by + ' · ' + st.at, bg: '#E6EEF8', fg: '#24508F' } }; if (seedT[kk]) return { t: seedT[kk], src: { t: 'Texto do relatório enviado', bg: '#E6EEF8', fg: '#24508F' } }; return { t: auto[s](), src: { t: 'Gerado automaticamente pelos dados', bg: '#FBF0D9', fg: '#7A4C00' } }; };
    const secs = SEC.map(([s, t]) => { const x = textOf(s), kk = key(ref, s), ed = S.editKey === kk; return { t, src: x.src, ps: x.t.split('\n').filter(Boolean), editing: ed, view: !ed, canEdit: !S.dir && !ed, edit: () => this.setState({ editKey: kk, editV: x.t }), regen: () => this.setState({ editV: auto[s]() }) }; });

    // motivo
    const hasMotivo = ref >= '2026-07';
    const mot = { '2026-07': [['Qualidade', 9], ['Preço', 4], ['Atendimento', 3], ['Proximidade do vendedor', 2], ['Custo-benefício', 2], ['Outro', 1]], '2026-08': [['Qualidade', 8], ['Atendimento', 5], ['Preço', 3], ['Custo-benefício', 2], ['Reputação da empresa', 1], ['Outro', 1]] }[ref] || [];
    const mMax = Math.max(1, ...mot.map(m => m[1]));
    const motivos = mot.map(([l, n]) => ({ l, n: String(n), w: (n / mMax * 100) + '%' }));
    const low = Math.round(cur.n * (cur.ind >= meta ? 0.12 : 0.3)), ocs = Math.max(0, Math.round(low * 0.5)), mans = Math.max(0, Math.round(low * 0.25));
    const trat = [{ l: 'Pesquisas com nota ≤ 6', v: String(low), c: RED }, { l: 'Ocorrências geradas', v: String(ocs), c: '#7A4C00' }, { l: 'Manifestações formais', v: String(mans), c: '#A80502' }, { l: 'Tratativas encerradas', v: String(Math.max(0, ocs + mans - (ref === avail[avail.length - 1] ? 1 : 0))), c: GREEN }];

    // monthly history
    const MT = emp === 'Chiacchio' ? this.monthTexts() : {};
    const hist = avail.slice(0, ri + 1).reverse().map(k => { const r = ser[k], op = S.allOpen || (S.openM || ref) === k; return { l: ml(k), v: f2(r.ind), c: col(r.ind), n: String(r.n), open: op, sign: op ? '−' : '+', bg: k === ref ? '#FFF8F8' : '#fff', ps: (MT[k] || ('Indicador de ' + f2(r.ind) + ' com ' + r.n + ' respostas. Atendimento ' + f2(r.at) + ', prazo de entrega ' + f2(r.pr) + ', qualidade ' + f2(r.qu) + ' e recomendação ' + f2(r.re) + '.')).split('\n'), go: () => this.setState({ openM: op && !S.allOpen ? 'none' : k }) }; });

    const envios = (S.db.envios[emp + '|' + ref] || []);
    const st = statusO ? { t: 'PUBLICADO · ' + statusO.at.slice(0, 10), bg: '#E6F2EA', fg: '#1E6B3A' } : { t: 'RASCUNHO · EM REVISÃO', bg: '#FBF0D9', fg: '#7A4C00' };
    const chip = (on, l, go) => ({ l, go, bg: on ? '#1F1F1F' : '#fff', fg: on ? '#fff' : '#3A3939', bd: on ? '#1F1F1F' : '#D6D6D6' });
    const DEST = ['Diretoria', 'Presidência', 'Gerência Comercial', 'Qualidade', 'Logística'];
    const slug = emp.toLowerCase(), shareUrl = 'https://assistentesac.vercel.app/relatorios/' + slug + '/' + ref + '?dir=1';
    return {
      topSub: S.dir ? 'Visão da Diretoria · somente leitura' : 'Pesquisa de satisfação · relatório mensal',
      notDir: !S.dir, togDir: () => this.setState({ dir: !S.dir, editKey: null }), dirJ: S.dir ? 'flex-end' : 'flex-start', dirB: S.dir ? '#C70602' : '#C4C4C4',
      printPdf: () => { try { window.print(); } catch (e) { } },
      empChips: [['Chiacchio', 'Chiacchio Embalagens'], ['Plaschio', 'Plaschio'], ['Tubahia', 'Tubahia']].map(([k, l]) => chip(emp === k, l, () => this.setState({ emp: k, editKey: null, openM: null }))),
      mes: ref, mesOpts: avail.slice().reverse().map(k => ({ v: k, l: mlong(k) })), onMes: e => this.setState({ mes: e.target.value, openM: null, editKey: null }),
      perChips: [['6', 'Últimos 6 meses'], ['12', '12 meses'], ['all', 'Desde nov/25']].map(([k, l]) => chip(S.per === k, l, () => this.setState({ per: k }))),
      meta: String(meta), onMeta: e => this.setState({ meta: e.target.value }), metaTxt, nextNote: 'Setembro/2026 em fechamento · disponível a partir de 05/10',
      hasLogo: true, logo: brand[0], brandC: brand[1], emp, empUp: emp === 'Chiacchio' ? 'CHIACCHIO EMBALAGENS' : emp.toUpperCase(), mesLong: mlong(ref), exemplo: emp !== 'Chiacchio',
      pubLine: statusO ? 'Publicado em ' + statusO.at + ' por ' + statusO.by + ' · dados atualizados automaticamente pelo Centro das Pesquisas' : 'Rascunho · os números são atualizados automaticamente pelo Centro das Pesquisas',
      st, hero, resumo, bars, metaLine, crit, tCols, tRows, secs,
      editV: S.editV, onEditV: e => this.setState({ editV: e.target.value }), cancelEdit: () => this.setState({ editKey: null }),
      saveEdit: () => { const db = JSON.parse(JSON.stringify(S.db)); db.texts[S.editKey] = { t: S.editV.trim(), at: this.now(), by: 'Luiza Martins' }; this.setState({ db, editKey: null }); this.save(db); this.flash('Texto salvo no relatório de ' + mword(ref) + '.'); },
      hasMotivo, noMotivo: !hasMotivo, motivos, motivoSub: hasMotivo ? cur.n + ' respostas · ' + mword(ref) : '', trat,
      hist, allL: S.allOpen ? 'Recolher todos' : 'Expandir todos', togAll: () => this.setState({ allOpen: !S.allOpen }),
      envios: envios.map(e => ({ at: e.at, to: e.to, views: e.views })), noEnvios: !envios.length,
      openSend: () => this.setState({ send: true, sendMsg: 'Segue o relatório de satisfação de clientes da ' + (emp === 'Chiacchio' ? 'Chiacchio Embalagens' : emp) + ' referente a ' + mword(ref) + '/' + ref.slice(0, 4) + '. Indicador do mês: ' + f2(cur.ind) + ' (meta ' + metaTxt + ').' }),
      sendOpen: S.send, closeSend: () => this.setState({ send: false }), destChips: DEST.map(d => chip(S.dest.includes(d), d, () => this.setState({ dest: S.dest.includes(d) ? S.dest.filter(x => x !== d) : S.dest.concat([d]) }))),
      sendMsg: S.sendMsg, onSendMsg: e => this.setState({ sendMsg: e.target.value }), shareUrl, copyUrl: () => { try { navigator.clipboard.writeText(shareUrl); } catch (e) { } this.flash('Link copiado.'); },
      pdfJ: S.pdf ? 'flex-end' : 'flex-start', pdfB: S.pdf ? '#C70602' : '#C4C4C4', togPdf: () => this.setState({ pdf: !S.pdf }),
      doSend: () => { if (!S.dest.length) return this.flash('Escolha ao menos um destinatário.'); const db = JSON.parse(JSON.stringify(S.db)), n = this.now(), k = emp + '|' + ref; db.status[k] = { t: 'Publicado', at: n, by: 'Luiza Martins' }; db.envios[k] = [{ at: n, to: S.dest.join(', ') + (S.pdf ? ' · com PDF' : ''), views: 'aguardando leitura' }].concat(db.envios[k] || []); this.setState({ db, send: false }); this.save(db); this.flash('Relatório publicado e enviado para ' + S.dest.join(', ') + '.'); },
      toast: S.toast
    };
  }
}
</script>
</body>
</html>

````
