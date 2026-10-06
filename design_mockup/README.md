# Handoff: Assistente SAC · Grupo Chiacchio

## Comando para o Claude Code

> Este pacote contém os mockups e as especificações do Assistente SAC (Grupo Chiacchio). Leia este README, depois `ESPECIFICACAO-ASSISTENTE-SAC.md` e os arquivos em `implementacao/`. Os arquivos `.dc.html` são **referências de design** (protótipos em HTML), não código de produção: recrie as telas no sistema existente, usando a arquitetura, as rotas, a autenticação e os componentes que já existem. Reproduza layout, textos, cores e comportamento **idênticos** aos mockups.
>
> Antes de implementar, entregue um diagnóstico por tela: o que já existe, o que falta, onde encaixa. Não altere a arquitetura, não duplique funcionalidades, não crie funcionalidades fictícias, não faça deploy.

## Overview

Plataforma interna de gestão de manifestações do SAC das empresas CHIACCHIO EMBALAGENS, PLASCHIO e TUBAHIA: registro, análise com apoio de IA (que só sugere; a decisão é humana), encaminhamento a setores, tratativa, RNC/RCA, aprovação, devolutiva ao cliente, arquivo de fichas, pesquisa de satisfação, relatórios e base de conhecimento (Cérebro). Hospedagem prevista: Vercel.

## About the Design Files

Os arquivos deste pacote são **protótipos em HTML** que mostram aparência e comportamento pretendidos. Não devem ser copiados para produção. A tarefa é recriá-los no ambiente do código existente (React, Next.js etc.) com os padrões já adotados. Os dados dos mockups são de exemplo; no sistema vêm do banco.

Cada `.dc.html` abre direto no navegador (precisa de `support.js` na mesma pasta e da pasta `assets/`). O template (markup com estilos inline) define o layout; a classe `Component` no `<script>` define dados de exemplo e regras de interação. `index.html` é o ponto de entrada para hospedar os mockups.

## Fidelity

**Alta fidelidade.** Cores, tipografia, espaçamentos, textos e interações são finais. Recriar pixel a pixel usando as bibliotecas do código existente.

## Screens / Views

| Arquivo | Tela | Especificação |
|---|---|---|
| `AssistenteSAC.dc.html` | Aplicação principal: página inicial (Registrar manifestação / Entrar no sistema / Solicitar acesso), login, menu, Dashboard, Manifestações, Nova manifestação (com análise da IA), detalhe, tratativa por setor, aprovações, devolutiva, Banco de casos, indicadores, setores, usuários e acessos | `ESPECIFICACAO-ASSISTENTE-SAC.md` |
| `MinhaCentralSAC.dc.html` | Minha Central SAC: fila pessoal com 7 contadores (Minhas, Pendentes, Em atraso, Ag. aprovação, Em tratamento, Encerradas, Externos), lista ordenada por prazo, detalhe com "Próxima ação" e painel Cérebro | seção abaixo |
| `CentralRCA.dc.html` | Central de RCA: ficha RNC RT-0001 digital, 5 porquês, ações, evidências vinculadas, rascunho/envio/devolução com versões | `ESPECIFICACAO-ASSISTENTE-SAC.md` |
| `Cerebro.dc.html` | Cérebro: base de conhecimento validada, sugestões pendentes de validação | `ESPECIFICACAO-ASSISTENTE-SAC.md` |
| `ArquivoFichas.dc.html` | Arquivo de Fichas: fichas do sistema + históricas importadas, por empresa/ano/mês, indicadores, reincidência, importação | `implementacao/IMPLEMENTACAO-ARQUIVO-DE-FICHAS.md` |
| `Fichas.dc.html` | Modelos de ficha A4: Ficha de Manifestação (nova, FR-SAC-01), Ficha de Encaminhamento (oficial em uso), RNC RT-0001 (5 páginas) | `implementacao/IMPLEMENTACAO-FICHAS.md` |
| `PesquisaSatisfacao.dc.html` | Pesquisa de Satisfação: pesquisa pública (boas-vindas com logo por empresa, perguntas, confirmação) e área interna (visão geral, por ano/mês, por empresa, dashboard, comentários, ocorrências, editor do questionário, notificações) | `implementacao/IMPLEMENTACAO-PESQUISA-SATISFACAO.md` |
| `RelatorioSatisfacao.dc.html` | Relatório mensal de satisfação para Diretoria e Presidência | `implementacao/IMPLEMENTACAO-PESQUISA-SATISFACAO.md` |
| `Alimentacao.dc.html` | Alimentação da ferramenta: 10 fontes de dados (histórico, cadastros, conhecimento), assistente de importação em 5 passos, histórico com desfazer, pendências de dados | `implementacao/IMPLEMENTACAO-ALIMENTACAO.md` |

### Minha Central SAC (resumo)

- **Layout**: menu lateral 232 px + área principal (padding 20/24 px). Cabeçalho com título 24 px/700, saudação, botões "↻ Atualizar" (primário) e "+ Nova Manifestação" (secundário). Linha de 7 contadores (grid `auto-fill minmax(118px,1fr)`, gap 8). Corpo em 3 colunas que quebram: lista (flex 1 1 320 px) · detalhe (flex 999 1 460 px) · Cérebro (flex 1 1 280 px).
- **Contadores**: clicáveis, filtram a lista; "Em Atraso" em vermelho (#C70602, fundo #FFF8F8, borda #F3CFCF).
- **Lista**: busca, Minhas / Todas permitidas, filtros Status, SLA (Atrasadas, Vencem em até 8 h, No prazo), Tipo, Prioridade. Ordenada por prazo. Item: ponto de prioridade (alta #C70602, média #D9A400, baixa #B5B5B5), protocolo, selo EXTERNO, selo de SLA ("Atrasada 1d" fundo vermelho texto branco · "Vence em 6h" #FBF0D9/#7A4C00), cliente, motivo · empresa, status, próxima ação.
- **Detalhe**: protocolo + status + SLA, link "Abrir ficha completa"; etapas (Aberta → Analisada → Encaminhada → Em tratativa → Aprovação → Devolutiva → Finalizada); quadro **Próxima ação** com botões por status (Nova: Assumir e analisar · Em análise: Validar e encaminhar · Em tratamento com setor atrasado: Cobrar setor / Escalar ao gestor · Ag. aprovação: Lembrar aprovador · Devolutiva: Registrar devolutiva / Usar sugestão do Cérebro · Encerrada: Ver ficha arquivada); dados; relato; setores acionados (Atrasado / Aguardando / Respondido); histórico.
- **Cérebro**: selo "SUGESTÃO DA IA · VALIDAR ANTES DE USAR"; alerta de reincidência (mesmo CNPJ, 2+ reclamações em 12 meses); causa mais provável com base; casos similares com % de similaridade; o que funcionou antes; devolutiva sugerida com "Usar como rascunho".
- **Externos**: manifestações vindas do portal público ou de representantes, status "Nova · triagem".

## Interactions & Behavior

- Todas as interações (filtros, abas, modais, painéis laterais, assistentes em passos, toasts de confirmação) estão implementadas nos mockups; abra cada arquivo e use-o como referência funcional.
- IA nunca decide: toda sugestão é rotulada "Sugestão da IA" e exige validação humana.
- Ações que mudam estado registram auditoria (usuário, data/hora, empresa, ação, versão).
- Permissões por empresa e perfil validadas no backend (403 fora do escopo). MASTER tem acesso global.
- Responsivo: grids `auto-fit/minmax`, tabelas com rolagem horizontal, sem sobreposição em desktop, tablet e mobile.

## State Management

Ver cada especificação. Entidades principais: Manifestação, Setor acionado/Tratativa, Aprovação, Devolutiva, RNC/RCA (com versões e evidências), Ficha (sistema/importada) e Documento, Questionário/Envio/Resposta/Ocorrência, Importação, Conhecimento (validado/pendente), Usuário/Perfil/Empresa.

## Design Tokens

- **Fonte**: Montserrat 400/500/600/700 (Google Fonts). Títulos de tela 24 px/700; seção 14–15 px/700; corpo 13–13,5 px; rótulos 10,5–11,5 px/600 com letter-spacing .05–.08em em maiúsculas.
- **Cores**: vermelho principal #C70602 · hover/texto #A80502 · escuro #7F0401 · texto #1F1F1F · secundário #545252 / #666464 · terciário #929090 · bordas #E4E4E4 / #D6D6D6 / #EFEFEF · fundo #F4F4F4 · cards #FFFFFF · realce vermelho claro #FDECEC / #FFF8F8.
- **Status**: Aberta/Nova #E6EEF8/#24508F · Em análise #EEE8F7/#5B3FA0 · Em tratamento #FBF0D9/#7A4C00 · Ag. aprovação #FCE9DC/#9A4A10 · Devolutiva #E3F3F4/#0E6B73 · Concluída/Encerrada #E6F2EA/#1E6B3A · Ocorrência de pesquisa #FFFBEF borda #D9A400.
- **Raios**: cards 10–12 px · botões/inputs 7–8 px · selos 99 px.
- **Espaçamento**: gaps 6/8/10/12/14/16 px; padding de cards 12–18 px.
- **Sombras**: não usadas; separação por bordas de 1 px.

## Assets

`assets/`: logo-chiacchio.png (Grupo), logo-chiacchio-embalagens.png, logo-plaschio.png, logo-tubahia.png (pesquisa e relatório por empresa), simbolo-vermelho.png (menu), simbolo-branco.png. Fornecidos pelo cliente (manual da marca).

## Files

- `index.html`: entrada para hospedar os mockups
- `*.dc.html`: telas (ver tabela)
- `support.js`, `doc-page.js`: execução dos mockups (não fazem parte do produto)
- `ESPECIFICACAO-ASSISTENTE-SAC.md`: especificação funcional geral
- `implementacao/*.md`: instruções detalhadas por tela, cada uma com comando pronto para o Claude Code
- `vercel.json`: configuração de hospedagem dos mockups
- `visualizacao-offline/`: as 9 telas em HTML único, abrem no navegador sem internet (só para visualização; links entre telas não funcionam)
- `imagens/`: PNGs da página inicial e do login
- `assets/`: logos
