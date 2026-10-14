---
name: Assistente SAC — Grupo Chiacchio
description: Sistema interno de gestão de manifestações; admin claro, preciso e auditável.
colors:
  chiacchio-red: "#C70602"
  chiacchio-red-dark: "#A80502"
  chiacchio-red-tint: "#FDEAEA"
  ink: "#1F1F1F"
  graphite: "#3A3939"
  slate: "#545252"
  steel: "#666464"
  muted: "#707070"
  line: "#E4E4E4"
  line-strong: "#D6D6D6"
  row-line: "#EFEFEF"
  canvas: "#F4F4F4"
  surface: "#FFFFFF"
  table-head: "#FAFAFA"
  success: "#10B981"
  success-tint: "#D1FAE5"
  success-deep: "#1E6B3A"
  success-deep-tint: "#E6F2EA"
  warning: "#F59E0B"
  warning-tint: "#FEF3C7"
  alert: "#F97316"
  alert-tint: "#FED7AA"
typography:
  display:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "normal"
  title:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
rounded:
  xs: "4px"
  sm: "7px"
  md: "10px"
  lg: "12px"
  pill: "99px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "20px"
components:
  button-primary:
    backgroundColor: "{colors.chiacchio-red}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "7px 14px"
  button-primary-hover:
    backgroundColor: "{colors.chiacchio-red-dark}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "7px 14px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "7px 14px"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.chiacchio-red}"
    rounded: "{rounded.sm}"
    padding: "7px 14px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  status-badge:
    backgroundColor: "{colors.success-deep-tint}"
    textColor: "{colors.success-deep}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  sidebar-item:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.slate}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
---

# Design System: Assistente SAC — Grupo Chiacchio

## Overview

**Creative North Star: "O Livro-Razão da Qualidade"**

Este é o sistema visual de um livro-razão: contábil, auditável, exato. Cada manifestação é uma entrada que precisa estar no lugar certo, legível e rastreável — e a interface existe para registrar, não para decorar. O branco e a família de cinzas carregam toda a densidade de dados; o vermelho da marca é o carimbo oficial, aplicado com parcimônia onde há autoridade ou ação. A atmosfera é **confiável e exata, profissional e institucional** — alinhada a uma área de qualidade sob ISO 9001, onde a confiança no registro vale mais que o brilho.

A superfície é **plana por padrão**: fundo cinza-claro, cartões brancos delimitados por uma linha fina de 1px, sem sombra em repouso. A profundidade aparece só quando o estado pede — o anel de foco vermelho em um campo, a sombra de um modal sobreposto. Os componentes são **firmes e confiantes**: contidos e funcionais, mas sem timidez nas ações primárias — o vermelho afirma, o hover responde com clareza. Nada grita sem motivo; tudo é escaneável sob volume.

O sistema rejeita explicitamente três coisas: o dashboard "colorido demais" de startup genérica (aqui a cor é funcional, nunca decorativa), o dark mode / neon / glassmorphism (este mundo é claro e sóbrio), e os acentos "cara de AI" — barras laterais coloridas grossas e destaques chamativos em cartões arredondados.

**Key Characteristics:**
- Branco e cinza carregam a UI; o vermelho é raro e significativo.
- Superfícies planas com borda de 1px; profundidade só por estado.
- Densidade de dados escaneável, tipografia compacta em Montserrat.
- Cantos suavemente arredondados (7–10px); status sempre em pílula.
- Nada decorativo: cada elemento registra ou aciona.

## Colors

Uma paleta quase monocromática de cinzas sobre branco, pontuada por um único vermelho de marca e três tons de status funcionais.

### Primary
- **Vermelho Chiacchio** (#C70602): a cor da marca e o único acento. Usado no item de navegação ativo, na ação primária, no anel de foco e em alertas que exigem ação. É o carimbo — sua raridade é o que lhe dá peso.
- **Vermelho Chiacchio Escuro** (#A80502): estado hover/pressionado da ação primária.
- **Vermelho Chiacchio Tênue** (#FDEAEA): fundo do anel de foco e realces discretos de seleção.

### Neutral
- **Tinta** (#1F1F1F): texto primário e títulos.
- **Grafite** (#3A3939): texto secundário de alto contraste.
- **Ardósia** (#545252): texto do menu lateral e rótulos de apoio.
- **Aço** (#666464): metadados e legendas de KPI.
- **Névoa** (#707070): texto secundário fraco, deltas, placeholders — escurecida de #929090 para passar WCAG AA (≈4.95:1).
- **Linha** (#E4E4E4): borda padrão de cartões e divisórias.
- **Linha Forte** (#D6D6D6): borda de botões secundários e campos em repouso mais marcados.
- **Linha de Tabela** (#EFEFEF): divisória entre linhas de listas e tabelas.
- **Tela** (#F4F4F4): fundo da aplicação.
- **Superfície** (#FFFFFF): fundo de cartões, painéis, menu lateral.
- **Cabeçalho de Tabela** (#FAFAFA): fundo do header de tabelas.

### Tertiary (status funcionais)
- **Verde Ativo** (#1E6B3A sobre #E6F2EA): selo de status "ativo/válido" (empresas, canais).
- **Verde Sucesso** (#10B981 sobre #D1FAE5): confirmação, dentro do prazo.
- **Âmbar Atenção** (#F59E0B sobre #FEF3C7): aviso, prazo em risco.
- **Laranja Alerta** (#F97316 sobre #FED7AA): urgência, próximo do estouro.

### Named Rules
**A Regra do Carimbo.** O Vermelho Chiacchio ocupa ≤10% de qualquer tela. Ele marca autoridade (ação primária, nav ativo, foco, alerta de ação) — nunca preenche áreas nem decora. Se há vermelho em dois lugares concorrendo pela atenção, um está errado.

**A Regra da Cor Funcional.** Nenhuma cor entra na tela sem significar um estado. Verde/âmbar/laranja são status, nunca enfeite. O resto é cinza sobre branco.

## Typography

**Display/Body Font:** Montserrat (com ui-sans-serif, system-ui, sans-serif)
**Mono:** monospace do sistema (apenas para identificadores técnicos pontuais)

**Character:** Uma única família geométrica carrega todo o sistema — Montserrat em pesos variados cria hierarquia sem trocar de fonte. A escala é compacta e profissional, pensada para densidade de dados lida o dia inteiro. Números usam `tabular-nums` para alinhar em colunas.

### Hierarchy
- **Display** (600, 26px, lh 1, -0.02em, tabular-nums): valores de KPI e números-chave em cartões de indicador.
- **Headline** (800, 18px, lh 1.2): títulos de modal e cabeçalhos de página.
- **Title** (700, 14.5px): títulos de cartão e seção de conteúdo.
- **Body** (400–500, 13–14px, lh 1.5): texto de interface padrão; 14px é a base, 13px para áreas densas (tabelas, listas).
- **Label** (600, 10.5px, 0.08em, MAIÚSCULAS): rótulos de seção do menu lateral e eyebrows de agrupamento.

### Named Rules
**A Regra da Fonte Única.** Tudo é Montserrat. Hierarquia vem de peso e tamanho, nunca de uma segunda família. O monospace aparece só em IDs técnicos.

**A Regra do Piso Legível.** Texto de conteúdo não desce abaixo de 13px, e metadados abaixo de 11px só quando não são essenciais à tarefa. O sistema é lido na mesa o dia inteiro — legibilidade vence compactação.

## Layout

Casca de aplicação fixa: menu lateral de 232px (branco, borda direita de 1px) + área principal rolável com topbar sticky. O conteúdo respira com padding de 24px 28px. Cartões se organizam em grids responsivos com `auto-fit`/`auto-fill` e `minmax` (ex.: KPIs em trilhas de ~170px; cartões de configuração em ~340px), com `gap` de 12–16px. O ritmo de espaçamento é curto e consistente: 6 / 10 / 16 / 20px. Listas e tabelas usam linhas divididas por uma única borda fina (#EFEFEF), sem zebra. Dentro de uma linha de grid, os cartões esticam à mesma altura (`align-items: stretch`) para manter a base alinhada.

## Elevation & Depth

Sistema **plano por padrão**. Superfícies em repouso não têm sombra — a hierarquia vem de bordas de 1px (#E4E4E4), do contraste branco-sobre-cinza e do espaçamento. A profundidade é reservada para dois papéis: **sobreposição** (modais, menus flutuantes) e **estado** (foco). Nunca é ambiente nem decorativa.

### Shadow Vocabulary
- **Foco** (`box-shadow: 0 0 0 2px var(--red-light)` + borda vermelha): anel ao redor de campos ativos.
- **Modal** (`box-shadow: 0 20px 60px rgba(0,0,0,0.4)`): diálogos sobre o backdrop.
- **Flutuante** (`box-shadow: 0 8px 32px rgba(0,0,0,0.18)`): popovers, menus e cartões destacados temporariamente.

### Named Rules
**A Regra do Plano em Repouso.** Cartões e painéis são planos com borda fina. Sombra só aparece como resposta a um estado (foco) ou a uma camada (overlay). Sombra ambiente permanente é proibida — ela imita elevação que este sistema não usa.

## Shapes

Linguagem de cantos suavemente arredondados e consistente por papel: **7px** é o raio-assinatura de controles (botões, inputs); **10px** para cartões e painéis; **12px** para contêineres maiores; **99px (pílula)** para todo status/tag. Avatares são círculos. Bordas são sempre de 1px e finas — exceto o acento de seleção de 3px no vermelho, usado com moderação em item de lista escolhido. Sem cantos vivos (0px) e sem raios exagerados que arredondem demais os controles.

## Components

### Buttons
- **Shape:** cantos suaves (7px); altura compacta, padding 7px 14px, 13px/500.
- **Primary:** fundo Vermelho Chiacchio (#C70602), texto branco. A ação afirmativa da tela.
- **Hover / Focus:** escurece para #A80502; transição `all 0.15s`. Foco visível obrigatório.
- **Secondary:** fundo branco, texto Tinta (#1F1F1F), borda 1px Linha Forte (#D6D6D6).
- **Ghost:** fundo transparente, texto e borda 1px no Vermelho Chiacchio — ação secundária de marca.

### Chips / Tags / Status
- **Style:** pílula (raio 99px), 11px/700, par fundo-tinta do tom de status (ex.: Verde Ativo #1E6B3A sobre #E6F2EA).
- **State:** mapeiam estado real (ativo, dentro/fora do prazo, atenção) — nunca decorativos.

### Cards / Containers
- **Corner Style:** 10px.
- **Background:** Superfície branca (#FFFFFF) sobre Tela (#F4F4F4).
- **Shadow Strategy:** nenhuma em repouso (ver Elevation & Depth).
- **Border:** 1px Linha (#E4E4E4).
- **Internal Padding:** 14–20px conforme densidade (KPI 14px 16px; cartão de conteúdo 20px).
- **Hover (quando clicável):** muda só a cor da borda (`border-color .15s`), sem elevar.

### Inputs / Fields
- **Style:** fundo branco, borda 1px Linha (#E4E4E4), raio 7px, 13px, texto Tinta.
- **Focus:** borda Vermelho Chiacchio + anel `0 0 0 2px #FDEAEA`.
- **Textarea:** mesmo tratamento, `min-height` ~100px, resize vertical.

### Navigation (sidebar)
- **Style:** 232px, branca, borda direita 1px. Itens 13.5px/500, Ardósia (#545252), raio 7px.
- **Section labels:** 10.5px/600, MAIÚSCULAS, tracking 0.08em, Névoa (#929090).
- **Active:** indicador em Vermelho Chiacchio (ponto/realce); item ativo ganha o acento, o resto permanece neutro.
- **Mobile:** colapsa em sobreposição (uso mobile real pelo perfil RCA).

## Do's and Don'ts

### Do:
- **Do** usar o Vermelho Chiacchio (#C70602) como acento raro — ação primária, nav ativo, foco, alerta de ação — respeitando a Regra do Carimbo (≤10% da tela).
- **Do** manter superfícies planas com borda de 1px (#E4E4E4); reservar sombra para foco e overlays.
- **Do** manter tudo em Montserrat, criando hierarquia por peso/tamanho, com `tabular-nums` em números.
- **Do** usar pílula (99px) para todo status e mapear cada cor a um estado real.
- **Do** respeitar o piso de legibilidade (texto de conteúdo ≥13px, bom contraste) — o sistema é lido o dia inteiro.

### Don't:
- **Don't** adicionar gradientes, múltiplas cores de acento ou "colorido de dashboard" — a cor é funcional.
- **Don't** introduzir dark mode, neon ou glassmorphism; este mundo é claro e sóbrio.
- **Don't** usar barras laterais coloridas grossas ou acentos chamativos em cartões arredondados ("cara de AI").
- **Don't** aplicar sombra ambiente permanente em cartões/painéis em repouso.
- **Don't** trocar de família tipográfica nem descer texto essencial abaixo de 13px.
