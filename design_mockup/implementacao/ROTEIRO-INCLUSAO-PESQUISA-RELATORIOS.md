# Roteiro — como incluir Pesquisa de Satisfação + Relatórios no Assistente SAC

Use este roteiro no Claude Code, **uma etapa por vez**. Cole o comando da etapa, espere terminar, teste e só então siga para a próxima. Não peça tudo de uma vez.

## Antes de começar

1. Copie para a pasta do projeto (raiz do repositório):
   - `PROMPT-PESQUISA-E-RELATORIOS.md` (especificação completa + mockups)
   - `assets/logo-chiacchio-embalagens.png`, `assets/logo-plaschio.png`, `assets/logo-tubahia.png`
2. Crie uma branch nova (ex.: `feature/pesquisa-satisfacao`). Nada vai direto para produção.
3. Tenha em mãos: a fórmula do indicador de satisfação usada hoje, a meta por empresa e a lista de e-mails da Diretoria e Presidência.

---

## Etapa 0 — Diagnóstico (não implementa nada)

```
Leia PROMPT-PESQUISA-E-RELATORIOS.md inteiro, incluindo os mockups dos anexos.
Depois analise o projeto atual e me entregue SOMENTE o diagnóstico, sem alterar nenhum arquivo:
1. Stack, estrutura de pastas, como rotas, telas, API e banco estão organizados.
2. O que já existe e será reutilizado: login, perfis/permissões, menu lateral, empresas, clientes, setores, manifestações (fluxo de Nova Manifestação), envio de e-mail/WhatsApp, geração de PDF, storage de arquivos, auditoria.
3. O que falta criar, item por item da especificação.
4. Tabelas novas e alterações nas existentes (migrations).
5. Rotas e endpoints novos.
6. Riscos e conflitos com o que já existe.
7. Plano de implementação nas etapas 1 a 6 deste roteiro, com os arquivos que serão criados/alterados em cada uma.
Não faça deploy.
```

**Você confere:** se ele entendeu que tudo fica dentro da ferramenta, que reutiliza login/menu/cadastros e que ocorrência de pesquisa não é manifestação. Corrija o que estiver errado antes de seguir.

---

## Etapa 1 — Banco de dados e permissões

```
Implemente a ETAPA 1 do plano aprovado: somente banco de dados e permissões do módulo Pesquisa de Satisfação + Relatórios, conforme as seções 9 e 10 de PROMPT-PESQUISA-E-RELATORIOS.md.
- Crie as migrations das tabelas novas (Questionario, Pergunta, Envio, Resposta, Ocorrencia, VinculoManifestacao, Relatorio, EnvioRelatorio).
- Todas com empresa e com validação de escopo por empresa no backend (403 fora do escopo).
- Registre as permissões novas (editar/publicar questionário, tratar nota baixa, publicar relatório, leitura Diretoria/Presidência) no sistema de perfis existente.
- Crie um questionário inicial publicado para cada empresa (CHIACCHIO EMBALAGENS, PLASCHIO, TUBAHIA) com as perguntas atuais: Recomendação (NPS 0–10), Qualidade dos produtos, Prazo de entrega, Atendimento, Motivo da compra, comentário.
Não crie telas ainda. Não altere outras funcionalidades. Não faça deploy.
Ao final: migrations criadas, permissões, como testar.
```

**Você testa:** banco criado; usuário de uma empresa não consegue ler dados de outra pela API.

---

## Etapa 2 — Questionário e pesquisa pública

```
Implemente a ETAPA 2: editor do questionário (seção 7) e pesquisa pública (seção 3) de PROMPT-PESQUISA-E-RELATORIOS.md, idênticos ao mockup PesquisaSatisfacao (Anexo A): telas Boas-vindas, perguntas, Confirmação e aba Questionário.
- Rota pública /pesquisa/:token sem login, mobile first, logo da empresa correta.
- Resposta única por token, link com validade, progresso salvo.
- Link geral por empresa (pede CNPJ/nome no início).
- Editor: rascunho → pré-visualizar → publicar, versões, reordenar perguntas, textos de boas-vindas e agradecimento, auditoria.
Reutilize o layout, menu e componentes existentes. Não faça deploy.
```

**Você testa:** editar e publicar questionário; responder pelo celular; tentar responder de novo; logos das 3 empresas.

---

## Etapa 3 — Envio das pesquisas

```
Implemente a ETAPA 3: envio de pesquisas (seção 4 de PROMPT-PESQUISA-E-RELATORIOS.md).
- Envio individual (pelo cliente e ao encerrar manifestação) e em lote.
- Canais pelas integrações existentes de e-mail/WhatsApp; se não houver integração, gerar link para copiar.
- Status Enviado / Aberto / Respondido / Expirado; não reenviar a quem respondeu nos últimos 90 dias.
Não crie integração fictícia: se faltar credencial, me avise. Não faça deploy.
```

**Você testa:** envio chega; status muda quando o cliente abre e responde.

---

## Etapa 4 — Centro das Pesquisas e tratamento de nota baixa

```
Implemente a ETAPA 4: Centro das Pesquisas (seção 5) e tratamento de nota baixa (seção 6), idênticos ao mockup PesquisaSatisfacao (Anexo A).
- Abas: Visão geral, Por ano e mês, Por empresa, Dashboard, Comentários, Ocorrências, Questionário, Notificações.
- Nota ≤ 6 marca automaticamente; setor sugerido (sugestão, não decisão).
- Três caminhos: GERAR OCORRÊNCIA (OCP, não é manifestação, fluxo próprio até encerrar) | TRANSFORMAR EM MANIFESTAÇÃO (usa o fluxo existente de Nova Manifestação, origem = Pesquisa de Satisfação, link para a pesquisa original) | NÃO REQUER TRATAMENTO (justificativa obrigatória).
- Histórico e rastreabilidade completos; prazo de decisão aparece na Minha Central SAC e nas notificações.
- OCP não entra nos indicadores de manifestação.
Não duplique o formulário de manifestação. Não faça deploy.
```

**Você testa:** os três caminhos de nota baixa; manifestação criada aparece na lista de manifestações com a origem; OCP aparece só para o setor certo.

---

## Etapa 5 — Relatórios de Satisfação

```
Implemente a ETAPA 5: Relatórios de Satisfação (seção 8 de PROMPT-PESQUISA-E-RELATORIOS.md), idêntico ao mockup RelatorioSatisfacao (Anexo B).
- Lista por empresa + mês; gerar relatório do mês em Rascunho com dados reais.
- Blocos na ordem do mockup: cabeçalho, Meta x Indicador do mês, Evolução do indicador, Resultado mensal, Motivo da compra, Notas baixas e tratativas, Análise mensal (Desempenho geral, Análise crítica, Pontos fortes, Oportunidades de melhoria, Ações recomendadas), Envios.
- Fórmula do indicador: [ESCREVA AQUI A FÓRMULA USADA HOJE]. Meta por empresa configurável. NPS = promotores − detratores.
- Publicar e enviar: gera PDF no layout do mockup, envia para Diretoria e Presidência, congela os dados; correção gera nova versão.
- PDF em storage persistente (não usar disco do servidor da Vercel).
- Diretoria/Presidência só leitura.
Não faça deploy.
```

**Você testa:** números do relatório batem com as respostas do mês; PDF igual ao mockup; e-mail chega à Diretoria; corrigir gera v2.

---

## Etapa 6 — Histórico, revisão final e testes

```
Implemente a ETAPA 6:
1. Permita importar o histórico das pesquisas antigas (planilhas) pela tela Alimentação da ferramenta, se ela já existir; senão, me diga como importar.
2. Rode todos os testes da seção 12 de PROMPT-PESQUISA-E-RELATORIOS.md e me mostre o resultado de cada um.
3. Compare cada tela com os mockups e liste diferenças.
4. Entregue: arquivos alterados, rotas, endpoints, tabelas, fórmulas, onde ficam os PDFs, pendências.
Não faça deploy.
```

**Você testa:** a lista de testes inteira, com usuários de perfis e empresas diferentes.

---

## Depois

- Revise a branch, faça o merge e publique na Vercel (preview primeiro, depois produção).
- Se algo ficar diferente do mockup, peça: "Ajuste a tela X para ficar idêntica ao mockup Y (anexo A/B), sem alterar a lógica."

## Regras para repetir sempre que ele sair do trilho

- Dentro da ferramenta: mesmo login, menu, cadastros e manifestações.
- IA só sugere; decisão é humana.
- Ocorrência de pesquisa não é manifestação.
- Sem ranking entre empresas.
- Validar permissão por empresa no backend.
- Não criar funcionalidade fictícia. Não fazer deploy.
