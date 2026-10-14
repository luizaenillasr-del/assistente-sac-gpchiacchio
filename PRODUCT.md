# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Sistema multi-perfil de uso interno do Grupo Chiacchio. O operador principal no dia a dia é o **Analista SAC**, que atende reclamações no desktop — registrando e encaminhando manifestações, frequentemente enquanto fala com o cliente ao telefone. O sistema também serve, em intensidades diferentes:

- **Gestor / Aprovador** — revisa e aprova tratativas, acompanha SLA e indicadores (uso de supervisão).
- **Setor Responsável** — recebe manifestações encaminhadas e responde causa/ação (uso pontual, não o dia todo).
- **RCA / Representante** — representante comercial que acompanha os casos dos seus clientes, muitas vezes em campo/celular.

Perfis adicionais presentes no controle de acesso: MASTER (acesso total), GESTOR SAC, AUDITOR, CONSULTA, ADMINISTRADOR, APROVADOR MASTER.

## Product Purpose

Assistente SAC e Gestão de Manifestações — plataforma interna para registrar, triar, tratar e encerrar **manifestações** (reclamações/ocorrências) dos clientes das empresas do Grupo Chiacchio. Centraliza o ciclo completo: entrada → análise (assistida por IA) → roteamento ao setor → tratativa → aprovação → devolutiva ao cliente → conclusão, com rastreabilidade total. Sucesso = toda manifestação resolvida dentro do SLA, com trilha auditável e realimentação da qualidade (RNC, sugestões de melhoria, base de conhecimento).

## Positioning

Gestão de manifestações **multi-empresa com isolamento rígido por empresa** e rastreabilidade ISO 9001, acoplada a um "cérebro" de IA que tria cada manifestação (tipo, setor sugerido, SLA, prioridade, tratativa e devolutiva sugeridas, casos similares) sem expor dados sensíveis ao provedor. O diferencial que um concorrente não copiaria de imediato: a base de conhecimento + matriz de setores específicas do Grupo Chiacchio, combinadas ao isolamento por empresa dentro de um único fluxo operacional.

## Operating Context

- **Canais de entrada:** Telefone, WhatsApp, E-mail, Site (formulário), Pesquisa de satisfação.
- **Empresas do grupo:** Chiacchio Embalagens, Plaschio, Cesbap, Tubahia.
- **Ciclo de vida da manifestação (status):** RECEBIDA → EM ANÁLISE → AGUARDANDO_DECISÃO → AGUARDANDO_APROVAÇÃO → APROVADA/REJEITADA → EM TRATATIVA / AGUARDANDO OUTRO SETOR / AGUARDANDO_DEVOLUTIVA → CONCLUÍDA/FINALIZADA.
- **Superfície interna:** ~25 telas — visão geral (dashboard), central SAC, nova manifestação, banco de manifestações, aprovadores, setor responsável, RCA, representantes, auditoria, banco RNC, base de conhecimento, matriz de conhecimento, cérebro (IA), relatório de satisfação, usuários, setores, causas, prazos regionais, fichas/biblioteca de fichas, sugestões de melhoria, similares, painel máquina, alimentação, configurações.
- **Ponto de contato com o cliente final:** a **pesquisa de satisfação** é o único ponto que chega ao cliente externo (resposta pública via token). O restante é 100% interno.
- **Ambiente técnico:** app web (Node/Express) servido na Vercel (serverless). Armazenamento atual em Google Sheets; migração para PostgreSQL/Neon em andamento (leitura PG desativada por padrão). Autenticação JWT + bcrypt.

## Capabilities and Constraints

- **Controle de acesso por perfil** (ver Users) com rotas protegidas por `requerPerfil`/`requerPermissao`.
- **Isolamento por empresa** aplicado em middleware de rota (`middlewareEscopoEmpresa`, `pertenceEmpresa`): cada empresa só enxerga os próprios dados.
- **Análise por IA** configurável (`AI_PROVIDER` = anthropic | openai); sugere tipo/setor/SLA/prioridade/tratativa/devolutiva e casos similares, com fallback heurístico quando não há chave. A IA sugere; a decisão (RNC, tratativa, devolutiva) é sempre humana.
- **RNC (Registro de Não Conformidade)** criado apenas por decisão humana explícita.
- **Relatórios** com ciclo rascunho → publicado, versionamento e link público compartilhável.
- **Pesquisas de satisfação** com resposta pública via token.
- **Log de auditoria permanente** e trilha de histórico por manifestação.
- **Terminologia fixa do negócio** (ver Brand Commitments).

## Brand Commitments

- Nome: **Grupo Chiacchio** — produto "Assistente SAC".
- **Vermelho da marca #C70602** (escuro #A80502) e tipografia **Montserrat** são identidade fixa.
- Logos existentes: `public/logo-chiacchio.png`, `public/simbolo-vermelho.png`, `public/simbolo-branco.png`.
- Idioma: **português (pt-BR)**.
- **Vocabulário da qualidade é fixo e compartilhado entre os perfis:** manifestação, reclamação, tratativa, devolutiva, RNC, ficha, SLA, procedência.

## Evidence on Hand

- Frontend real de produção: `public/index.html` (SPA, ~22 mil linhas).
- Dados de exemplo para teste: `tests/sheets-mock.js` (usuários, manifestações, reclamações).
- Documentação técnica: `docs/MAPA_ROTAS.md`, `docs/FASE2_ROTEIRO.md`, `docs/MAPEAMENTO-FICHAS.md`, `docs/ROLLBACK.md`.
- Assets de marca em `public/`.
- **Não há** dados reais de clientes, depoimentos ou métricas no repositório — trabalhos futuros não devem fabricá-los.

## Product Principles

1. **Rastreabilidade acima de tudo** — toda ação é auditável (ISO 9001); nada se perde.
2. **Isolamento por empresa é inviolável** — nenhuma empresa do grupo enxerga dados de outra.
3. **A IA sugere, o humano decide** — triagem automatizada, mas RNC/tratativa/devolutiva exigem decisão humana.
4. **O SLA é a métrica-rainha** — nenhum prazo pode estourar silenciosamente.
5. **Vocabulário da qualidade é compartilhado e fixo** entre todos os perfis.

## Accessibility & Inclusion

- Interface em **pt-BR**, de uso predominante em **desktop** (atendimento o dia inteiro na mesa), com uso **mobile** real pelo perfil RCA/Representante em campo.
- Necessidade conhecida a preservar/melhorar: **legibilidade** — contraste de texto e tamanho de fonte adequados para uso prolongado na mesa e em tela de celular. Não há norma formal de acessibilidade estabelecida além das exigências de qualidade ISO 9001.
