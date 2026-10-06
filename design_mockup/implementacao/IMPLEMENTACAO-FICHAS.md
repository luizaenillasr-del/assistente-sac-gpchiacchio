# Implementação — Tela "Fichas" (modelos de ficha) · Assistente SAC

## Comando (cole no Claude Code)

> Implemente a tela **Fichas** do Assistente SAC conforme este arquivo (IMPLEMENTACAO-FICHAS.md). Ela reúne os 3 modelos oficiais de ficha, em A4, prontos para imprimir/baixar em PDF e usados como base dos formulários digitais. As fichas têm objetivo duplo: alimentar a ferramenta com os dados E ficar armazenadas como documento permanente (novas e antigas), conforme a seção 5. Reproduza estrutura, nomes de seções, nomes de campos e opções **exatamente** como descrito; o mockup completo está no anexo. Não remova, renomeie ou altere o significado de nenhum campo. Antes de implementar, mapeie: CAMPO DA FICHA → CAMPO NO SISTEMA → EXISTE / NÃO EXISTE → O QUE FALTA. Não altere a arquitetura, não crie funcionalidades fictícias, não faça deploy.

---

## 1. O que é a tela

- Biblioteca de **modelos de ficha** do SAC, em páginas **A4** (retrato), margem 12–13 mm.
- Acesso pelos links "modelos de ficha em branco" (prévia do PDF da manifestação) e "Modelos de ficha (nova e antiga) ↗" (Banco de casos), abrindo em nova aba.
- Cada modelo deve existir em duas formas:
  1. **em branco**, para impressão/PDF;
  2. **preenchida**, gerada pelo sistema a partir dos dados da manifestação/RNC (mesmo layout).
- Botão de imprimir/baixar PDF; navegação entre páginas.

São 3 modelos, 8 páginas no total:

| Pág. | Modelo |
|---|---|
| 1–2 | Ficha de Manifestação (modelo novo, FR-SAC-01) |
| 3 | Ficha de Encaminhamento de Manifestação (modelo oficial em uso) |
| 4–8 | Relatório de Não Conformidade RT-0001 (RNC, 5 páginas) |

## 2. Modelo 1 — Ficha de Manifestação (modelo novo) · 2 páginas

Cabeçalho: logo Grupo Chiacchio · "SAC · ASSISTENTE SAC" · título **Ficha de Manifestação** · subtítulo "Modelo novo · preenchido dentro da ferramenta · documento controlado ISO 9001" · caixa com **Nº MAN-______** e **Abertura __/__/____ __:__**. Linha vermelha #C70602 abaixo. Títulos de seção em faixa vermelha com texto branco.

**1. DADOS DO CLIENTE**: Razão social · CNPJ · Código do cliente · Nome do contato · Telefone · E-mail · Cidade/UF

**2. DADOS DA MANIFESTAÇÃO**
- Empresa: ☐ Chiacchio ☐ Plaschio ☐ Cesbap ☐ Outra
- Canal de entrada: ☐ Telefone ☐ WhatsApp ☐ E-mail ☐ Presencial ☐ Site ☐ Representante ☐ Pesquisa de satisfação
- Tipo: ☐ Reclamação ☐ Solicitação ☐ Sugestão ☐ Elogio ☐ Dúvida ☐ Denúncia
- Descrição da manifestação do cliente
- Produto · Pedido · NF · Lote · Data de entrega · Transportadora · Vendedor · Representante · Quantidade envolvida
- Evidências anexadas: ☐ Fotos ☐ PDF ☐ Vídeo ☐ Prints ☐ Documentos ☐ Áudio · Qtde

**3. ANÁLISE DA IA E VALIDAÇÃO DO SAC**
- Tabela: Campo | Sugestão da IA | Decisão do SAC | Aceita/Editada/Rejeitada (☐ A ☐ E ☐ R), linhas: Categoria/Motivo · Causa/Subcausa · Setor responsável · Prioridade
- Reincidente? ☐ Sim ☐ Não · Ocorrências · Casos similares (nº) · Procedência ☐ Sim ☐ Não ☐ Parcial
- Motivo da divergência com a IA / justificativa da procedência

**4. ENCAMINHAMENTO**: Setor principal / setores de apoio · Data de encaminhamento · Prazo (SLA) / data limite

Rodapé p1: "Grupo Chiacchio · Assistente SAC · FR-SAC-01 rev. 2026 · Página 1 de 2"

**Página 2** (cabeçalho "Ficha de Manifestação · continuação" + Nº MAN):

**5. TRATATIVA DO SETOR · uma por setor acionado**: Setor · Responsável · Data da resposta · O que aconteceu? · Qual foi a causa da ocorrência? · Como o caso foi resolvido para este cliente? · Ação para evitar novas ocorrências · responsável · prazo · Responsabilidade do setor ☐ Sim ☐ Não ☐ Parcial · Comunicar à Qualidade ☐ Sim ☐ Não · Status ☐ Resolvida ☐ Aguardando terceiro ☐ Aguardando cliente
- Nota fixa: "Reclamação registrada pelo SAC não gera RNC. RNC é aberta só por reclamação via Comercial, auditoria externa, auditoria interna ou desvio de especificação de matéria-prima. Para mais de um setor, a ferramenta gera um bloco 5 por setor. Em papel, use uma folha adicional por setor."
- No sistema: **repetir o bloco 5 para cada setor acionado**.

**6. APROVAÇÕES**: Item a aprovar (reposição, devolução, compensação, resposta) · Aprovação (tipo/valor) · Aprovador · data

**7. DEVOLUTIVA AO CLIENTE**: Texto sugerido pela IA ☐ Aceito ☐ Editado ☐ Rejeitado · Canal ☐ WhatsApp ☐ E-mail ☐ Telefone ☐ Carta · Texto final enviado (baseado nos fatos da tratativa, sem assumir culpa antecipadamente) · Responsável · Data de envio · Confirmação de envio ☐ Sim

**8. ENCERRAMENTO E HISTÓRICO**: Cliente informado ☐ Sim ☐ Não · Manifestação resolvida ☐ Sim ☐ Não · Data de finalização · Follow-up previsto · Tabela Etapa | Data e hora | Responsável com as etapas: Aberta · Analisada · Encaminhada · Em tratativa · Devolutiva · Finalizada

Rodapé p2: "Na ferramenta, todos os campos são preenchidos digitalmente e registrados na auditoria. · Página 2 de 2"

## 3. Modelo 2 — Ficha de Encaminhamento de Manifestação (oficial em uso) · 1 página

Cabeçalho: logo · "SAC · MODELO OFICIAL EM USO" · título **FICHA DE ENCAMINHAMENTO DE MANIFESTAÇÃO** · "Reproduz a ficha de reclamação vigente · usada também para importar fichas antigas no banco de casos". Linha cinza. Títulos de seção em negrito com sublinhado preto (sem faixa vermelha). **Manter textos exatamente como na ficha original, inclusive maiúsculas e perguntas.**

1. **Dados do Registro SAC**: Data do Registro · Setor (SAC) · Nº Reclamação · Atendente · Canal de Atendimento ( ) Telefone ( ) WhatsApp ( ) E-mail ( ) Presencial ( ) Pesquisa de Satisfação ( ) Outro
2. **Dados do Cliente**: Nome do Cliente · Empresa / Razão Social · CNPJ · Telefone / WhatsApp · E-mail
3. **Informações da Manifestação**: Tipo [ ] Reclamação [ ] Dúvida [ ] Sugestão [ ] Elogio · A reclamação é procedente? [ ] Sim [ ] Não [ ] Parcialmente · Justifique. · Descrição Detalhada da Manifestação
4. **Informações do Produto (quando aplicável)**: Produto · Lote · NFe
5. **Encaminhamento**: Data de Encaminhamento · Prazo para Retorno ao SAC: **72 horas.**
6. **Resposta do Setor** (cada pergunta com instrução em cinza):
   - O que aconteceu? (Descreva objetivamente o que aconteceu.)
   - Qual foi a causa da ocorrência? (Por que isso aconteceu?)
   - Como o caso foi resolvido para este cliente? (O que foi feito para solucionar esta reclamação específica?)
   - Qual ação será adotada para evitar novas ocorrências? (Informar a ação corretiva ou preventiva que será implementada.)
   - Responsável pela ação de melhoria · Prazo para implementação da ação
7. **Validação do SAC**: Data de Retorno ao Cliente · Cliente Informado ( ) Sim ( ) Não · Manifestação Resolvida ( ) Sim ( ) Não · Observações Finais

Rodapé: "Grupo Chiacchio · SAC · Ficha de Encaminhamento de Manifestação · Página 1 de 1"

Uso no sistema: é o **mapa de importação** das fichas antigas (PDF/DOCX) para o Arquivo de Fichas e o Banco de casos.

## 4. Modelo 3 — RNC RT-0001 (Relatório de Não Conformidade) · 5 páginas

Cabeçalho em grade com borda preta, **repetido em todas as 5 páginas**: logo · Empresa: Chiacchio Embalagens · **RT-0001 Rev: 0000** · Tipo de Documento: Relatório de Não Conformidade · Criado: Gildásio Jr – Coordenador de Qualidade/ Process · Aprovado: Deibson Veloso – Diretor de Produção · Data: 20/03/26 · "N de 5". **Texto do cabeçalho idêntico à ficha oficial.**

**Página 1/5**
- **DADOS DE ENTRADA**: EMITIDA POR · RECEBIDO POR · DATA VERIFICAÇÃO · N° RNC · SETOR · LOTE · OPERADOR · PRODUTO · QUANTIDADE · CLIENTE · CONTATO
- **ORIGEM DA NÃO CONFORMIDADE**: ☐ ANÁLISE CRÍTICA DA ALTA DIREÇÃO ☐ AUDITORIA INTERNA ☐ AUDITORIA EXTERNA ☐ RNC EXTERNA ☐ INSPEÇÃO INTERNA ☐ AVALIAÇÃO SAC
- Tabela: Tipo (☐ Real ☐ Potencial) | Plano de Ação? (☐ Sim ☐ Não) | Procedente? (☐ Sim ☐ Não) | Devolução? (☐ Sim ☐ Não)
- **DESCRIÇÃO DA NÃO CONFORMIDADE/ OBSERVAÇÃO** (campo grande)
- **AÇÕES DE CORREÇÃO IMEDIATA**: tabela AÇÃO | RESPONSÁVEL | PRAZO

**Página 2/5**
- **ANÁLISE DE CAUSA:** 5 porquês — "POR QUE OCORREU / PROBLEMA 1:" até "PROBLEMA 5:" · **CAUSA RAIZ:** (destaque em fundo rosado #FDF2F2, texto #A80502)
- **AÇÃO DE CORREÇÃO**: tabela AÇÃO | RESPONSÁVEL | PRAZO | STATUS
- VERIFICAÇÃO · **VERIFICAÇÃO DA EFICÁCIA:** ☐ CONFORME ☐ NÃO CONFORME · DATA · NOVA NC: ☐ SIM ☐ NÃO · DATA

**Página 3/5 — ANEXO DE EVIDÊNCIA DA NC:** área para fotos, registros e documentos
**Página 4/5 — EVIDÊNCIA DAS AÇÕES:** área para fotos, registros e documentos
**Página 5/5 — EVIDÊNCIA DA EFICÁCIA:** área para fotos, registros e documentos

No sistema: as 3 páginas de evidência recebem os anexos da Central de RCA, cada um com nome, descrição, quem anexou e data/hora, e vinculados à etapa correspondente (NC, ações, eficácia).

Nota fixa no rodapé: "Na Central de RCA esta ficha é preenchida digitalmente, com evidências vinculadas e histórico de versões."

## 5. Objetivo duplo: alimentar a ferramenta E armazenar as fichas

As fichas têm duas funções, e as duas são obrigatórias:

1. **Alimentar a ferramenta**: os dados de cada ficha viram campos estruturados no banco (manifestação, cliente, setor, causa, ações, RNC). É isso que abastece indicadores, Banco de casos, Cérebro, reincidência e relatórios.
2. **Armazenar a ficha como documento**: cada ficha fica guardada como **registro permanente**, consultável e baixável a qualquer momento, no **Arquivo de Fichas** (ver IMPLEMENTACAO-ARQUIVO-DE-FICHAS.md).

### 5.1 Fichas novas (preenchidas na ferramenta)
- Ao **encerrar** a manifestação (ou concluir a RNC), o sistema gera o **PDF final da ficha preenchida** no layout do modelo e **armazena esse PDF** vinculado à manifestação/RNC.
- Durante o processo, a ficha digital fica disponível e atualizada; o PDF final é o documento de arquivo.
- Se houver reabertura ou correção depois do encerramento: gerar **nova versão** do PDF e **manter a anterior** (sem sobrescrever).
- Evidências (fotos, PDFs, documentos) ficam armazenadas junto da ficha, com nome, descrição, autor e data/hora.

### 5.2 Fichas antigas (anteriores à ferramenta)
- Importar PDF/DOCX/digitalizações das fichas em papel ou planilhas.
- **Guardar o arquivo original sem alteração** (é o documento de prova).
- Extrair os dados para os campos do modelo 2 (Ficha de Encaminhamento de Manifestação) para alimentar o Banco de casos e os indicadores; o usuário confere empresa, data e campos lidos.
- Ficha importada é arquivada pela **data da reclamação original**, não pela data da importação.
- Campo não identificado na ficha antiga fica em branco e marcado como "não informado na ficha original" (não inventar dados).

### 5.3 Organização do armazenamento
- Estrutura: **Empresa → Ano → Mês → Ficha** (mesma do Arquivo de Fichas).
- Cada ficha armazenada guarda: protocolo, empresa, data da reclamação, cliente/CNPJ, tipo, modelo usado (FR-SAC-01, Ficha de Encaminhamento, RT-0001), origem (sistema ou importada), versão, arquivo(s), quem gerou/importou e quando.
- Nome padrão de arquivo: `EMPRESA_AAAA-MM-DD_PROTOCOLO_vN.pdf` (ex.: `CHIACCHIO_2026-09-29_MAN-0142_v1.pdf`).
- Armazenamento em serviço de arquivos persistente (ex.: storage do provedor já usado pelo sistema), **não** em pasta temporária do servidor. Na Vercel, o disco do servidor não é permanente: usar storage externo (Vercel Blob, S3 ou equivalente já adotado).
- Ligação no banco: tabela de documentos com `ficha_id`, `manifestacao_id`/`rnc_id`, `empresa`, `tipo_documento`, `versao`, `url_arquivo`, `hash`, `criado_por`, `criado_em`.

### 5.4 Retenção e segurança
- Fichas e evidências **não são excluídas** pela interface; só arquivadas. Qualquer substituição gera nova versão e registro em auditoria.
- Guardar hash do arquivo para comprovar que não foi alterado.
- Acesso por empresa e permissão, validado no backend (403 fora do escopo), inclusive no link de download (links assinados/temporários).
- Prazo de retenção: definir com a Qualidade (documento controlado ISO 9001).

### 5.5 Testes adicionais
1. Encerrar manifestação → PDF gerado e aparece no Arquivo de Fichas, na empresa/mês certos.
2. Reabrir e encerrar de novo → v2 criada, v1 preservada.
3. Importar ficha antiga → original preservado (hash igual), dados no Banco de casos.
4. Logout/login e novo deploy → fichas continuam disponíveis.
5. Usuário de outra empresa tentando baixar pelo link/ID → 403.

## 6. Regras

- Fonte Montserrat; vermelho #C70602; texto #1F1F1F; rótulos #666464 (6,8 pt); linhas de preenchimento #929090; corpo 8,6 pt; mínimo legível na impressão.
- Paginação fixa A4: cada página cabe inteira, sem cortar seções.
- Campos ☐ viram checkbox/radio no digital; linhas viram campos de texto; caixas grandes viram texto longo.
- PDF preenchido sempre no mesmo layout do modelo em branco; número da manifestação/RNC no cabeçalho de todas as páginas.
- Versão do documento (FR-SAC-01 rev. 2026, RT-0001 Rev: 0000) visível e controlada.

## 7. Pontos para confirmar antes de implementar

- Modelo 1, campo Empresa: o mockup traz **Chiacchio · Plaschio · Cesbap · Outra**. As empresas do grupo usadas no restante do sistema são **Chiacchio Embalagens, Plaschio e Tubahia**. Confirmar se "Cesbap" deve ser trocado por "Tubahia".
- Modelo 3, cabeçalho: está fixo como "Empresa: Chiacchio Embalagens". Confirmar se muda conforme a empresa da RNC.

## 8. Testes

1. Imprimir/baixar PDF de cada modelo em branco (A4, sem cortes).
2. Gerar ficha preenchida de uma manifestação com 2 setores (bloco 5 duplicado).
3. Gerar RNC preenchida com evidências nas páginas 3, 4 e 5.
4. Conferir todos os campos contra este documento.

---

## Anexo — código-fonte do mockup Fichas.dc.html

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
<title>Fichas de Manifestação · Grupo Chiacchio</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
<script src="./doc-page.js"></script>
<style>
doc-page:not(:defined){visibility:hidden}
body{margin:0;font-family:Montserrat,system-ui,sans-serif;color:#1F1F1F;-webkit-font-smoothing:antialiased}
a{color:#A80502}a:hover{color:#7F0401}
*{box-sizing:border-box}
</style>
</helmet>
<doc-page size="a4">

<section class="page" id="p1" data-screen-label="01 Ficha nova · p1" style="padding:12mm 13mm;display:flex;flex-direction:column;gap:3.2mm;font-size:8.6pt;line-height:1.3;font-family:Montserrat,system-ui,sans-serif">
  <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #C70602;padding-bottom:3mm;gap:6mm">
    <img src="assets/logo-chiacchio.png" alt="Grupo Chiacchio" style="height:15mm;width:auto;display:block">
    <div style="flex:1"><div style="font-size:7.5pt;letter-spacing:.12em;color:#C70602;font-weight:700">SAC · ASSISTENTE SAC</div><div style="font-size:13pt;font-weight:700">Ficha de Manifestação</div><div style="font-size:7.5pt;color:#666464">Modelo novo · preenchido dentro da ferramenta · documento controlado ISO 9001</div></div>
    <div style="border:1px solid #1F1F1F;padding:2mm 3mm;text-align:right;font-size:7.5pt;line-height:1.5"><div>Nº <strong style="font-size:10pt">MAN-______</strong></div><div>Abertura ___/___/______ ___:___</div></div>
  </div>

  <div style="background:#C70602;color:#fff;font-weight:700;font-size:8pt;letter-spacing:.06em;padding:1.4mm 2.5mm">1. DADOS DO CLIENTE</div>
  <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1.8mm 3mm">
    <div style="grid-column:span 2"><div style="font-size:6.8pt;color:#666464">Razão social</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">CNPJ</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Código do cliente</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Nome do contato</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Telefone</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">E-mail</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Cidade/UF</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
  </div>

  <div style="background:#C70602;color:#fff;font-weight:700;font-size:8pt;letter-spacing:.06em;padding:1.4mm 2.5mm">2. DADOS DA MANIFESTAÇÃO</div>
  <div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:1.6mm 4mm;align-items:center">
    <span style="font-size:6.8pt;color:#666464">Empresa</span><span>☐ Chiacchio &#160; ☐ Plaschio &#160; ☐ Cesbap &#160; ☐ Outra: __________</span>
    <span style="font-size:6.8pt;color:#666464">Canal de entrada</span><span>☐ Telefone &#160; ☐ WhatsApp &#160; ☐ E-mail &#160; ☐ Presencial &#160; ☐ Site &#160; ☐ Representante &#160; ☐ Pesquisa de satisfação</span>
    <span style="font-size:6.8pt;color:#666464">Tipo</span><span>☐ Reclamação &#160; ☐ Solicitação &#160; ☐ Sugestão &#160; ☐ Elogio &#160; ☐ Dúvida &#160; ☐ Denúncia</span>
  </div>
  <div><div style="font-size:6.8pt;color:#666464">Descrição da manifestação do cliente</div><div style="border:1px solid #929090;height:20mm"></div></div>
  <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1.8mm 3mm">
    <div style="grid-column:span 2"><div style="font-size:6.8pt;color:#666464">Produto</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Pedido</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">NF</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Lote</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Data de entrega</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Transportadora</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Vendedor</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Representante</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Quantidade envolvida</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
  </div>
  <div><span style="font-size:6.8pt;color:#666464">Evidências anexadas &#160;</span>☐ Fotos &#160; ☐ PDF &#160; ☐ Vídeo &#160; ☐ Prints &#160; ☐ Documentos &#160; ☐ Áudio &#160; Qtde: ____</div>

  <div style="background:#C70602;color:#fff;font-weight:700;font-size:8pt;letter-spacing:.06em;padding:1.4mm 2.5mm">3. ANÁLISE DA IA E VALIDAÇÃO DO SAC</div>
  <table style="border-collapse:collapse;width:100%;font-size:7.8pt">
    <thead><tr style="background:#F4F4F4"><th style="text-align:left;padding:1.2mm 2mm;border:1px solid #CFCFCF;width:22%">Campo</th><th style="text-align:left;padding:1.2mm 2mm;border:1px solid #CFCFCF">Sugestão da IA</th><th style="text-align:left;padding:1.2mm 2mm;border:1px solid #CFCFCF">Decisão do SAC</th><th style="padding:1.2mm 2mm;border:1px solid #CFCFCF;width:24%">Aceita / Editada / Rejeitada</th></tr></thead>
    <tbody>
      <tr><td style="padding:1.6mm 2mm;border:1px solid #CFCFCF">Categoria / Motivo</td><td style="border:1px solid #CFCFCF"></td><td style="border:1px solid #CFCFCF"></td><td style="border:1px solid #CFCFCF;text-align:center">☐ A &#160; ☐ E &#160; ☐ R</td></tr>
      <tr><td style="padding:1.6mm 2mm;border:1px solid #CFCFCF">Causa / Subcausa</td><td style="border:1px solid #CFCFCF"></td><td style="border:1px solid #CFCFCF"></td><td style="border:1px solid #CFCFCF;text-align:center">☐ A &#160; ☐ E &#160; ☐ R</td></tr>
      <tr><td style="padding:1.6mm 2mm;border:1px solid #CFCFCF">Setor responsável</td><td style="border:1px solid #CFCFCF"></td><td style="border:1px solid #CFCFCF"></td><td style="border:1px solid #CFCFCF;text-align:center">☐ A &#160; ☐ E &#160; ☐ R</td></tr>
      <tr><td style="padding:1.6mm 2mm;border:1px solid #CFCFCF">Prioridade</td><td style="border:1px solid #CFCFCF"></td><td style="border:1px solid #CFCFCF"></td><td style="border:1px solid #CFCFCF;text-align:center">☐ A &#160; ☐ E &#160; ☐ R</td></tr>
          </tbody>
  </table>
  <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.8mm 3mm">
    <div><div style="font-size:6.8pt;color:#666464">Reincidente?</div><div>☐ Sim &#160; ☐ Não &#160; Ocorrências: ____</div></div>
    <div><div style="font-size:6.8pt;color:#666464">Casos similares (nº)</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Procedência</div><div>☐ Sim &#160; ☐ Não &#160; ☐ Parcial</div></div>
  </div>
  <div><div style="font-size:6.8pt;color:#666464">Motivo da divergência com a IA / justificativa da procedência</div><div style="border:1px solid #929090;height:9mm"></div></div>

  <div style="background:#C70602;color:#fff;font-weight:700;font-size:8pt;letter-spacing:.06em;padding:1.4mm 2.5mm">4. ENCAMINHAMENTO</div>
  <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1.8mm 3mm">
    <div style="grid-column:span 2"><div style="font-size:6.8pt;color:#666464">Setor principal / setores de apoio</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Data de encaminhamento</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Prazo (SLA) / data limite</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
  </div>
  <div style="margin-top:auto;display:flex;justify-content:space-between;font-size:6.8pt;color:#929090;border-top:1px solid #E4E4E4;padding-top:2mm"><span>Grupo Chiacchio · Assistente SAC · FR-SAC-01 rev. 2026</span><span>Página 1 de 2</span></div>
</section>

<section class="page" id="p2" data-screen-label="02 Ficha nova · p2" style="padding:12mm 13mm;display:flex;flex-direction:column;gap:2.5mm;font-size:8.6pt;line-height:1.3;font-family:Montserrat,system-ui,sans-serif">
  <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #C70602;padding-bottom:2.5mm"><span style="font-weight:700;font-size:10pt">Ficha de Manifestação · continuação</span><span style="font-size:8pt">Nº <strong>MAN-______</strong></span></div>

  <div style="background:#C70602;color:#fff;font-weight:700;font-size:8pt;letter-spacing:.06em;padding:1.4mm 2.5mm">5. TRATATIVA DO SETOR · uma por setor acionado</div>
  <div style="border:1px solid #CFCFCF;padding:2.5mm;display:flex;flex-direction:column;gap:2mm">
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.8mm 3mm"><div><div style="font-size:6.8pt;color:#666464">Setor</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">Responsável</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">Data da resposta</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div></div>
    <div><div style="font-size:6.8pt;color:#666464">O que aconteceu?</div><div style="border-bottom:1px solid #929090;height:7mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Qual foi a causa da ocorrência?</div><div style="border-bottom:1px solid #929090;height:7mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Como o caso foi resolvido para este cliente?</div><div style="border-bottom:1px solid #929090;height:7mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Ação para evitar novas ocorrências · responsável · prazo</div><div style="border-bottom:1px solid #929090;height:7mm"></div></div>
    <div style="display:flex;gap:6mm;flex-wrap:wrap"><span>Responsabilidade do setor: ☐ Sim ☐ Não ☐ Parcial</span><span>Comunicar à Qualidade: ☐ Sim ☐ Não</span><span>Status: ☐ Resolvida ☐ Aguardando terceiro ☐ Aguardando cliente</span></div>
  </div>
  <div style="font-size:7pt;color:#666464">Reclamação registrada pelo SAC não gera RNC. RNC é aberta só por reclamação via Comercial, auditoria externa, auditoria interna ou desvio de especificação de matéria-prima. Para mais de um setor, a ferramenta gera um bloco 5 por setor. Em papel, use uma folha adicional por setor.</div>

  <div style="background:#C70602;color:#fff;font-weight:700;font-size:8pt;letter-spacing:.06em;padding:1.4mm 2.5mm">6. APROVAÇÕES</div>
  <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1.8mm 3mm">
    <div style="grid-column:span 2"><div style="font-size:6.8pt;color:#666464">Item a aprovar (reposição, devolução, compensação, resposta)</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Aprovação (tipo / valor)</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Aprovador · data</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
  </div>

  <div style="background:#C70602;color:#fff;font-weight:700;font-size:8pt;letter-spacing:.06em;padding:1.4mm 2.5mm">7. DEVOLUTIVA AO CLIENTE</div>
  <div style="display:flex;gap:6mm;flex-wrap:wrap"><span>Texto sugerido pela IA: ☐ Aceito ☐ Editado ☐ Rejeitado</span><span>Canal: ☐ WhatsApp ☐ E-mail ☐ Telefone ☐ Carta</span></div>
  <div><div style="font-size:6.8pt;color:#666464">Texto final enviado (baseado nos fatos da tratativa, sem assumir culpa antecipadamente)</div><div style="border:1px solid #929090;height:18mm"></div></div>
  <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.8mm 3mm"><div><div style="font-size:6.8pt;color:#666464">Responsável</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">Data de envio</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">Confirmação de envio</div><div>☐ Sim</div></div></div>

  <div style="background:#C70602;color:#fff;font-weight:700;font-size:8pt;letter-spacing:.06em;padding:1.4mm 2.5mm">8. ENCERRAMENTO E HISTÓRICO</div>
  <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1.8mm 3mm">
    <div><div style="font-size:6.8pt;color:#666464">Cliente informado</div><div>☐ Sim ☐ Não</div></div>
    <div><div style="font-size:6.8pt;color:#666464">Manifestação resolvida</div><div>☐ Sim ☐ Não</div></div>
    <div><div style="font-size:6.8pt;color:#666464">Data de finalização</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
    <div><div style="font-size:6.8pt;color:#666464">Follow-up previsto</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div>
  </div>
  <table style="border-collapse:collapse;width:100%;font-size:7.6pt">
    <thead><tr style="background:#F4F4F4"><th style="text-align:left;padding:1.2mm 2mm;border:1px solid #CFCFCF;width:18%">Etapa</th><th style="text-align:left;padding:1.2mm 2mm;border:1px solid #CFCFCF;width:22%">Data e hora</th><th style="text-align:left;padding:1.2mm 2mm;border:1px solid #CFCFCF">Responsável</th></tr></thead>
    <tbody>
      <tr><td style="padding:1.5mm 2mm;border:1px solid #CFCFCF">Aberta</td><td style="border:1px solid #CFCFCF"></td><td style="border:1px solid #CFCFCF"></td></tr>
      <tr><td style="padding:1.5mm 2mm;border:1px solid #CFCFCF">Analisada</td><td style="border:1px solid #CFCFCF"></td><td style="border:1px solid #CFCFCF"></td></tr>
      <tr><td style="padding:1.5mm 2mm;border:1px solid #CFCFCF">Encaminhada</td><td style="border:1px solid #CFCFCF"></td><td style="border:1px solid #CFCFCF"></td></tr>
      <tr><td style="padding:1.5mm 2mm;border:1px solid #CFCFCF">Em tratativa</td><td style="border:1px solid #CFCFCF"></td><td style="border:1px solid #CFCFCF"></td></tr>
      <tr><td style="padding:1.5mm 2mm;border:1px solid #CFCFCF">Devolutiva</td><td style="border:1px solid #CFCFCF"></td><td style="border:1px solid #CFCFCF"></td></tr>
      <tr><td style="padding:1.5mm 2mm;border:1px solid #CFCFCF">Finalizada</td><td style="border:1px solid #CFCFCF"></td><td style="border:1px solid #CFCFCF"></td></tr>
    </tbody>
  </table>
  <div style="margin-top:auto;display:flex;justify-content:space-between;font-size:6.8pt;color:#929090;border-top:1px solid #E4E4E4;padding-top:2mm"><span>Na ferramenta, todos os campos são preenchidos digitalmente e registrados na auditoria.</span><span>Página 2 de 2</span></div>
</section>

<section class="page" id="p3" data-screen-label="03 Ficha de reclamação (oficial)" style="padding:12mm 13mm;display:flex;flex-direction:column;gap:2.3mm;font-size:8.6pt;line-height:1.3;font-family:Montserrat,system-ui,sans-serif">
  <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #929090;padding-bottom:3mm;gap:6mm">
    <img src="assets/logo-chiacchio.png" alt="Grupo Chiacchio" style="height:15mm;width:auto;display:block">
    <div style="flex:1"><div style="font-size:7.5pt;letter-spacing:.12em;color:#666464;font-weight:700">SAC · MODELO OFICIAL EM USO</div><div style="font-size:13pt;font-weight:700">FICHA DE ENCAMINHAMENTO DE MANIFESTAÇÃO</div><div style="font-size:7.5pt;color:#666464">Reproduz a ficha de reclamação vigente · usada também para importar fichas antigas no banco de casos</div></div>
  </div>
  <div style="font-weight:700;font-size:8.8pt;border-bottom:1px solid #1F1F1F;padding-bottom:1mm">1. Dados do Registro SAC</div>
  <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1.8mm 3mm"><div><div style="font-size:6.8pt;color:#666464">Data do Registro</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">Setor</div><div style="border-bottom:1px solid #929090;height:5mm;padding-top:.6mm">SAC</div></div><div><div style="font-size:6.8pt;color:#666464">Nº Reclamação</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">Atendente</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div></div>
  <div><span style="font-size:6.8pt;color:#666464">Canal de Atendimento: &#160;</span>( ) Telefone &#160; ( ) WhatsApp &#160; ( ) E-mail &#160; ( ) Presencial &#160; ( ) Pesquisa de Satisfação &#160; ( ) Outro</div>
  <div style="font-weight:700;font-size:8.8pt;border-bottom:1px solid #1F1F1F;padding-bottom:1mm">2. Dados do Cliente</div>
  <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.8mm 3mm"><div><div style="font-size:6.8pt;color:#666464">Nome do Cliente</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">Empresa / Razão Social</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">CNPJ</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">Telefone / WhatsApp</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div style="grid-column:span 2"><div style="font-size:6.8pt;color:#666464">E-mail</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div></div>
  <div style="font-weight:700;font-size:8.8pt;border-bottom:1px solid #1F1F1F;padding-bottom:1mm">3. Informações da Manifestação</div>
  <div>Tipo de Manifestação: [ ] Reclamação &#160; [ ] Dúvida &#160; [ ] Sugestão &#160; [ ] Elogio</div>
  <div>A reclamação é procedente? &#160; [ ] Sim &#160; [ ] Não &#160; [ ] Parcialmente</div>
  <div><div style="font-size:6.8pt;color:#666464">Justifique.</div><div style="border-bottom:1px solid #929090;height:7mm"></div></div>
  <div><div style="font-size:6.8pt;color:#666464">Descrição Detalhada da Manifestação:</div><div style="border:1px solid #929090;height:16mm"></div></div>
  <div style="font-weight:700;font-size:8.8pt;border-bottom:1px solid #1F1F1F;padding-bottom:1mm">4. Informações do Produto (quando aplicável)</div>
  <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.8mm 3mm"><div><div style="font-size:6.8pt;color:#666464">Produto</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">Lote</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">NFe</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div></div>
  <div style="font-weight:700;font-size:8.8pt;border-bottom:1px solid #1F1F1F;padding-bottom:1mm">5. Encaminhamento</div>
  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.8mm 3mm"><div><div style="font-size:6.8pt;color:#666464">Data de Encaminhamento</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">Prazo para Retorno ao SAC</div><div style="border-bottom:1px solid #929090;height:5mm;padding-top:.6mm">72 horas.</div></div></div>
  <div style="font-weight:700;font-size:8.8pt;border-bottom:1px solid #1F1F1F;padding-bottom:1mm">6. Resposta do Setor</div>
  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2mm 4mm">
    <div><div style="font-size:7.4pt;font-weight:600">O que aconteceu?</div><div style="font-size:6.6pt;color:#666464">(Descreva objetivamente o que aconteceu.)</div><div style="border:1px solid #929090;height:10mm;margin-top:1mm"></div></div>
    <div><div style="font-size:7.4pt;font-weight:600">Qual foi a causa da ocorrência?</div><div style="font-size:6.6pt;color:#666464">(Por que isso aconteceu?)</div><div style="border:1px solid #929090;height:10mm;margin-top:1mm"></div></div>
    <div><div style="font-size:7.4pt;font-weight:600">Como o caso foi resolvido para este cliente?</div><div style="font-size:6.6pt;color:#666464">(O que foi feito para solucionar esta reclamação específica?)</div><div style="border:1px solid #929090;height:10mm;margin-top:1mm"></div></div>
    <div><div style="font-size:7.4pt;font-weight:600">Qual ação será adotada para evitar novas ocorrências?</div><div style="font-size:6.6pt;color:#666464">(Informar a ação corretiva ou preventiva que será implementada.)</div><div style="border:1px solid #929090;height:10mm;margin-top:1mm"></div></div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.8mm 4mm"><div><div style="font-size:6.8pt;color:#666464">Responsável pela ação de melhoria</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">Prazo para implementação da ação</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div></div>
  <div style="font-weight:700;font-size:8.8pt;border-bottom:1px solid #1F1F1F;padding-bottom:1mm">7. Validação do SAC</div>
  <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.8mm 3mm"><div><div style="font-size:6.8pt;color:#666464">Data de Retorno ao Cliente</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">Cliente Informado</div><div>( ) Sim &#160; ( ) Não</div></div><div><div style="font-size:6.8pt;color:#666464">Manifestação Resolvida</div><div>( ) Sim &#160; ( ) Não</div></div></div>
  <div><div style="font-size:6.8pt;color:#666464">Observações Finais:</div><div style="border:1px solid #929090;height:9mm"></div></div>
  <div style="margin-top:auto;display:flex;justify-content:space-between;font-size:6.8pt;color:#929090;border-top:1px solid #E4E4E4;padding-top:2mm"><span>Grupo Chiacchio · SAC · Ficha de Encaminhamento de Manifestação</span><span>Página 1 de 1</span></div>
</section>

<section class="page" id="p4" data-screen-label="04 RNC RT-0001 · 1 de 5" style="padding:12mm 13mm;display:flex;flex-direction:column;gap:3mm;font-size:8.6pt;line-height:1.3;font-family:Montserrat,system-ui,sans-serif">
  <div style="display:grid;grid-template-columns:42mm minmax(0,1fr) 40mm;border:1px solid #1F1F1F;font-size:7.4pt">
    <div style="grid-row:span 2;border-right:1px solid #1F1F1F;display:grid;place-items:center;padding:1.5mm"><img src="assets/logo-chiacchio.png" alt="Grupo Chiacchio" style="height:13mm;width:auto"></div>
    <div style="padding:1.5mm 2.5mm;border-right:1px solid #1F1F1F;border-bottom:1px solid #1F1F1F"><strong>Empresa:</strong> Chiacchio Embalagens</div>
    <div style="padding:1.5mm 2.5mm;border-bottom:1px solid #1F1F1F"><strong>RT-0001</strong> &#160; Rev: 0000</div>
    <div style="padding:1.5mm 2.5mm;border-right:1px solid #1F1F1F"><strong>Tipo de Documento:</strong> Relatório de Não Conformidade<div style="font-size:6.4pt;color:#545252;margin-top:.6mm">Criado: Gildásio Jr – Coordenador de Qualidade/ Process · Aprovado: Deibson Veloso – Diretor de Produção</div></div>
    <div style="padding:1.5mm 2.5mm">Data: 20/03/26<br>1 de 5</div>
  </div>
  <div style="background:#C70602;color:#fff;font-weight:700;font-size:8pt;letter-spacing:.06em;padding:1.4mm 2.5mm">DADOS DE ENTRADA</div>
  <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2mm 3mm"><div><div style="font-size:6.8pt;color:#666464">EMITIDA POR:</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">RECEBIDO POR:</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">DATA VERIFICAÇÃO:</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">N° RNC:</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">SETOR:</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">LOTE:</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">OPERADOR:</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">PRODUTO:</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">QUANTIDADE:</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div><div style="font-size:6.8pt;color:#666464">CLIENTE:</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div><div style="grid-column:span 2"><div style="font-size:6.8pt;color:#666464">CONTATO:</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div></div>
  <div style="background:#C70602;color:#fff;font-weight:700;font-size:8pt;letter-spacing:.06em;padding:1.4mm 2.5mm">ORIGEM DA NÃO CONFORMIDADE</div>
  <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.6mm 3mm"><span style="white-space:nowrap">☐ ANÁLISE CRÍTICA DA ALTA DIREÇÃO</span><span style="white-space:nowrap">☐ AUDITORIA INTERNA</span><span style="white-space:nowrap">☐ AUDITORIA EXTERNA</span><span style="white-space:nowrap">☐ RNC EXTERNA</span><span style="white-space:nowrap">☐ INSPEÇÃO INTERNA</span><span style="white-space:nowrap">☐ AVALIAÇÃO SAC</span></div>
  <table style="border-collapse:collapse;width:100%;font-size:7.8pt"><thead><tr style="background:#F4F4F4"><th style="padding:1.2mm 2mm;border:1px solid #CFCFCF;text-align:left">Tipo</th><th style="padding:1.2mm 2mm;border:1px solid #CFCFCF;text-align:left">Plano de Ação?</th><th style="padding:1.2mm 2mm;border:1px solid #CFCFCF;text-align:left">Procedente?</th><th style="padding:1.2mm 2mm;border:1px solid #CFCFCF;text-align:left">Devolução?</th></tr></thead><tbody><tr><td style="padding:1.5mm 2mm;border:1px solid #CFCFCF">☐ Real<br>☐ Potencial</td><td style="padding:1.5mm 2mm;border:1px solid #CFCFCF">☐ Sim<br>☐ Não</td><td style="padding:1.5mm 2mm;border:1px solid #CFCFCF">☐ Sim<br>☐ Não</td><td style="padding:1.5mm 2mm;border:1px solid #CFCFCF">☐ Sim<br>☐ Não</td></tr></tbody></table>
  <div style="background:#C70602;color:#fff;font-weight:700;font-size:8pt;letter-spacing:.06em;padding:1.4mm 2.5mm">DESCRIÇÃO DA NÃO CONFORMIDADE/ OBSERVAÇÃO</div>
  <div style="border:1px solid #929090;height:42mm"></div>
  <div style="background:#C70602;color:#fff;font-weight:700;font-size:8pt;letter-spacing:.06em;padding:1.4mm 2.5mm">AÇÕES DE CORREÇÃO IMEDIATA</div>
  <table style="border-collapse:collapse;width:100%;font-size:7.6pt"><thead><tr style="background:#F4F4F4"><th style="text-align:left;padding:1.2mm 2mm;border:1px solid #CFCFCF">AÇÃO</th><th style="text-align:left;padding:1.2mm 2mm;border:1px solid #CFCFCF">RESPONSÁVEL</th><th style="text-align:left;padding:1.2mm 2mm;border:1px solid #CFCFCF">PRAZO</th></tr></thead><tbody><tr><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td></tr><tr><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td></tr><tr><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td></tr><tr><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td></tr><tr><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td></tr></tbody></table>
  <div style="margin-top:auto;font-size:6.8pt;color:#929090;border-top:1px solid #E4E4E4;padding-top:2mm">Na Central de RCA esta ficha é preenchida digitalmente, com evidências vinculadas e histórico de versões.</div>
</section>

<section class="page" id="p5" data-screen-label="05 RNC RT-0001 · 2 de 5" style="padding:12mm 13mm;display:flex;flex-direction:column;gap:3mm;font-size:8.6pt;line-height:1.3;font-family:Montserrat,system-ui,sans-serif">
  <div style="display:grid;grid-template-columns:42mm minmax(0,1fr) 40mm;border:1px solid #1F1F1F;font-size:7.4pt">
    <div style="grid-row:span 2;border-right:1px solid #1F1F1F;display:grid;place-items:center;padding:1.5mm"><img src="assets/logo-chiacchio.png" alt="Grupo Chiacchio" style="height:13mm;width:auto"></div>
    <div style="padding:1.5mm 2.5mm;border-right:1px solid #1F1F1F;border-bottom:1px solid #1F1F1F"><strong>Empresa:</strong> Chiacchio Embalagens</div>
    <div style="padding:1.5mm 2.5mm;border-bottom:1px solid #1F1F1F"><strong>RT-0001</strong> &#160; Rev: 0000</div>
    <div style="padding:1.5mm 2.5mm;border-right:1px solid #1F1F1F"><strong>Tipo de Documento:</strong> Relatório de Não Conformidade<div style="font-size:6.4pt;color:#545252;margin-top:.6mm">Criado: Gildásio Jr – Coordenador de Qualidade/ Process · Aprovado: Deibson Veloso – Diretor de Produção</div></div>
    <div style="padding:1.5mm 2.5mm">Data: 20/03/26<br>2 de 5</div>
  </div>
  <div style="background:#C70602;color:#fff;font-weight:700;font-size:8pt;letter-spacing:.06em;padding:1.4mm 2.5mm">ANÁLISE DE CAUSA:</div>
  <div style="display:grid;grid-template-columns:30mm minmax(0,1fr);gap:3mm;align-items:end"><div style="font-size:7pt"><div style="color:#666464">POR QUE OCORREU</div><strong>PROBLEMA 1:</strong></div><div style="border-bottom:1px solid #929090;height:9mm"></div></div><div style="display:grid;grid-template-columns:30mm minmax(0,1fr);gap:3mm;align-items:end"><div style="font-size:7pt"><div style="color:#666464">POR QUE OCORREU</div><strong>PROBLEMA 2:</strong></div><div style="border-bottom:1px solid #929090;height:9mm"></div></div><div style="display:grid;grid-template-columns:30mm minmax(0,1fr);gap:3mm;align-items:end"><div style="font-size:7pt"><div style="color:#666464">POR QUE OCORREU</div><strong>PROBLEMA 3:</strong></div><div style="border-bottom:1px solid #929090;height:9mm"></div></div><div style="display:grid;grid-template-columns:30mm minmax(0,1fr);gap:3mm;align-items:end"><div style="font-size:7pt"><div style="color:#666464">POR QUE OCORREU</div><strong>PROBLEMA 4:</strong></div><div style="border-bottom:1px solid #929090;height:9mm"></div></div><div style="display:grid;grid-template-columns:30mm minmax(0,1fr);gap:3mm;align-items:end"><div style="font-size:7pt"><div style="color:#666464">POR QUE OCORREU</div><strong>PROBLEMA 5:</strong></div><div style="border-bottom:1px solid #929090;height:9mm"></div></div>
  <div style="display:grid;grid-template-columns:30mm minmax(0,1fr);gap:3mm;align-items:end;background:#FDF2F2;padding:2mm"><strong style="font-size:7.6pt;color:#A80502">CAUSA RAIZ:</strong><div style="border-bottom:1px solid #929090;height:11mm"></div></div>
  <div style="background:#C70602;color:#fff;font-weight:700;font-size:8pt;letter-spacing:.06em;padding:1.4mm 2.5mm">AÇÃO DE CORREÇÃO</div>
  <table style="border-collapse:collapse;width:100%;font-size:7.6pt"><thead><tr style="background:#F4F4F4"><th style="text-align:left;padding:1.2mm 2mm;border:1px solid #CFCFCF">AÇÃO</th><th style="text-align:left;padding:1.2mm 2mm;border:1px solid #CFCFCF">RESPONSÁVEL</th><th style="text-align:left;padding:1.2mm 2mm;border:1px solid #CFCFCF">PRAZO</th><th style="text-align:left;padding:1.2mm 2mm;border:1px solid #CFCFCF">STATUS</th></tr></thead><tbody><tr><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td></tr><tr><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td></tr><tr><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td></tr><tr><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td></tr><tr><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td><td style="border:1px solid #CFCFCF;height:7mm"></td></tr></tbody></table>
  <div style="background:#C70602;color:#fff;font-weight:700;font-size:8pt;letter-spacing:.06em;padding:1.4mm 2.5mm">VERIFICAÇÃO:</div>
  <div style="border:1px solid #929090;height:16mm"></div>
  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3mm">
    <div style="border:1px solid #CFCFCF;padding:2.5mm;display:flex;flex-direction:column;gap:1.5mm"><strong style="font-size:7.6pt">VERIFICAÇÃO DA EFICÁCIA:</strong><div>☐ CONFORME &#160; ☐ NÃO CONFORME</div><div><div style="font-size:6.8pt;color:#666464">DATA:</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div></div>
    <div style="border:1px solid #CFCFCF;padding:2.5mm;display:flex;flex-direction:column;gap:1.5mm"><strong style="font-size:7.6pt">NOVA NC:</strong><div>☐ SIM &#160; ☐ NÃO</div><div><div style="font-size:6.8pt;color:#666464">DATA:</div><div style="border-bottom:1px solid #929090;height:5mm"></div></div></div>
  </div>
</section>

<section class="page" id="p6" data-screen-label="06 RNC RT-0001 · 3 de 5" style="padding:12mm 13mm;display:flex;flex-direction:column;gap:3mm;font-size:8.6pt;line-height:1.3;font-family:Montserrat,system-ui,sans-serif">
  <div style="display:grid;grid-template-columns:42mm minmax(0,1fr) 40mm;border:1px solid #1F1F1F;font-size:7.4pt">
    <div style="grid-row:span 2;border-right:1px solid #1F1F1F;display:grid;place-items:center;padding:1.5mm"><img src="assets/logo-chiacchio.png" alt="Grupo Chiacchio" style="height:13mm;width:auto"></div>
    <div style="padding:1.5mm 2.5mm;border-right:1px solid #1F1F1F;border-bottom:1px solid #1F1F1F"><strong>Empresa:</strong> Chiacchio Embalagens</div>
    <div style="padding:1.5mm 2.5mm;border-bottom:1px solid #1F1F1F"><strong>RT-0001</strong> &#160; Rev: 0000</div>
    <div style="padding:1.5mm 2.5mm;border-right:1px solid #1F1F1F"><strong>Tipo de Documento:</strong> Relatório de Não Conformidade<div style="font-size:6.4pt;color:#545252;margin-top:.6mm">Criado: Gildásio Jr – Coordenador de Qualidade/ Process · Aprovado: Deibson Veloso – Diretor de Produção</div></div>
    <div style="padding:1.5mm 2.5mm">Data: 20/03/26<br>3 de 5</div>
  </div>
  <div style="background:#C70602;color:#fff;font-weight:700;font-size:8pt;letter-spacing:.06em;padding:1.4mm 2.5mm">ANEXO DE EVIDÊNCIA DA NC:</div>
  <div style="flex:1;border:1.5px dashed #CFCFCF;display:grid;place-items:center;color:#929090;font-size:8pt">Espaço para fotos, registros e documentos</div>
</section>

<section class="page" id="p7" data-screen-label="07 RNC RT-0001 · 4 de 5" style="padding:12mm 13mm;display:flex;flex-direction:column;gap:3mm;font-size:8.6pt;line-height:1.3;font-family:Montserrat,system-ui,sans-serif">
  <div style="display:grid;grid-template-columns:42mm minmax(0,1fr) 40mm;border:1px solid #1F1F1F;font-size:7.4pt">
    <div style="grid-row:span 2;border-right:1px solid #1F1F1F;display:grid;place-items:center;padding:1.5mm"><img src="assets/logo-chiacchio.png" alt="Grupo Chiacchio" style="height:13mm;width:auto"></div>
    <div style="padding:1.5mm 2.5mm;border-right:1px solid #1F1F1F;border-bottom:1px solid #1F1F1F"><strong>Empresa:</strong> Chiacchio Embalagens</div>
    <div style="padding:1.5mm 2.5mm;border-bottom:1px solid #1F1F1F"><strong>RT-0001</strong> &#160; Rev: 0000</div>
    <div style="padding:1.5mm 2.5mm;border-right:1px solid #1F1F1F"><strong>Tipo de Documento:</strong> Relatório de Não Conformidade<div style="font-size:6.4pt;color:#545252;margin-top:.6mm">Criado: Gildásio Jr – Coordenador de Qualidade/ Process · Aprovado: Deibson Veloso – Diretor de Produção</div></div>
    <div style="padding:1.5mm 2.5mm">Data: 20/03/26<br>4 de 5</div>
  </div>
  <div style="background:#C70602;color:#fff;font-weight:700;font-size:8pt;letter-spacing:.06em;padding:1.4mm 2.5mm">EVIDÊNCIA DAS AÇÕES:</div>
  <div style="flex:1;border:1.5px dashed #CFCFCF;display:grid;place-items:center;color:#929090;font-size:8pt">Espaço para fotos, registros e documentos</div>
</section>

<section class="page" id="p8" data-screen-label="08 RNC RT-0001 · 5 de 5" style="padding:12mm 13mm;display:flex;flex-direction:column;gap:3mm;font-size:8.6pt;line-height:1.3;font-family:Montserrat,system-ui,sans-serif">
  <div style="display:grid;grid-template-columns:42mm minmax(0,1fr) 40mm;border:1px solid #1F1F1F;font-size:7.4pt">
    <div style="grid-row:span 2;border-right:1px solid #1F1F1F;display:grid;place-items:center;padding:1.5mm"><img src="assets/logo-chiacchio.png" alt="Grupo Chiacchio" style="height:13mm;width:auto"></div>
    <div style="padding:1.5mm 2.5mm;border-right:1px solid #1F1F1F;border-bottom:1px solid #1F1F1F"><strong>Empresa:</strong> Chiacchio Embalagens</div>
    <div style="padding:1.5mm 2.5mm;border-bottom:1px solid #1F1F1F"><strong>RT-0001</strong> &#160; Rev: 0000</div>
    <div style="padding:1.5mm 2.5mm;border-right:1px solid #1F1F1F"><strong>Tipo de Documento:</strong> Relatório de Não Conformidade<div style="font-size:6.4pt;color:#545252;margin-top:.6mm">Criado: Gildásio Jr – Coordenador de Qualidade/ Process · Aprovado: Deibson Veloso – Diretor de Produção</div></div>
    <div style="padding:1.5mm 2.5mm">Data: 20/03/26<br>5 de 5</div>
  </div>
  <div style="background:#C70602;color:#fff;font-weight:700;font-size:8pt;letter-spacing:.06em;padding:1.4mm 2.5mm">EVIDÊNCIA DA EFICÁCIA:</div>
  <div style="flex:1;border:1.5px dashed #CFCFCF;display:grid;place-items:center;color:#929090;font-size:8pt">Espaço para fotos, registros e documentos</div>
</section>

</doc-page>
</x-dc>
</body>
</html>

````
