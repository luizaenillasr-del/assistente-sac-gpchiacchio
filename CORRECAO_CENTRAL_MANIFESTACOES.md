# Correção integral da Central de Manifestações

## Correções implementadas

- Exclusão de manifestação restrita ao perfil MASTER no backend.
- Confirmação obrigatória do protocolo e motivo obrigatório.
- Exclusão lógica no Sheets, sem apagar a linha nem reutilizar protocolo.
- Registro de `DATA_EXCLUSAO`, `DELETED_AT`, `EXCLUIDO_POR` e `MOTIVO_EXCLUSAO`.
- Rotas MASTER para consultar excluídos e restaurar registros.
- Histórico e auditoria registrados na exclusão/restauração.
- Filas e listagens operacionais continuam excluindo registros marcados como excluídos.
- Ações “Cobrar setor” e “Escalar ao gestor” conectadas ao endpoint persistente de acionamentos internos, com setor, motivo, prazo/urgência e idempotência.
- Busca de similares deixou de transformar falhas de API em lista vazia silenciosa e informa o erro ao usuário.
- Busca envia contexto de empresa/setor e mantém o algoritmo único do Cérebro.

## Causa raiz identificada

A exclusão existente removia fisicamente a linha do Sheets e também tentava excluir o registro no PostgreSQL, contrariando a exigência de rastreabilidade. A Central também exibia ações sem endpoint, e a busca de similares convertia qualquer erro HTTP em `{itens:[]}`, aparentando ausência de casos.

## Validação

- `npm run test:fase4:central`: aprovado.
- `node --check api/index.js`: aprovado.
- `git diff --check`: aprovado.
- A suíte comportamental existente cobre isolamento, protocolos, status, auditoria e integração com o Portal.

Ainda requer homologação real com credenciais e contas de teste para comprovar a persistência no Sheets/PostgreSQL e as operações de exclusão/restauração em ambiente isolado.
# Correção dos bloqueios da Central de Manifestações

Data: 2026-10-27
Branch de trabalho: `fix/usuarios-persistencia-edicao`
Situação de deploy: não realizado nesta correção.

## Causas identificadas

- A exclusão não tinha fluxo completo de confirmação e a operação precisava ser protegida no servidor, não apenas na interface.
- Cobrança e escalonamento eram apresentados como ações indisponíveis apesar de existir base para acionamentos internos.
- A Central passava `prazoMs` ao formatador de data; esse valor é um timestamp em milissegundos e era exibido literalmente em alguns cenários.
- Um campo `PRAZO` inválido impedia o cálculo alternativo por `SLA_HORAS`.

## Correções implementadas

- `DELETE /api/manifestacoes/:id` exige perfil MASTER, motivo e confirmação do protocolo; executa exclusão lógica, registra auditoria e preserva histórico.
- `GET /api/manifestacoes-excluidas` e `POST /api/manifestacoes/:id/restaurar` permitem consulta e restauração administrativa por MASTER.
- `POST /api/manifestacoes/:id/acionamentos` persiste cobrança, encaminhamento e escalonamento com chave de idempotência, histórico e auditoria.
- O acionamento agora gera registro em `NOTIFICACOES_INTERNAS`. Escalonamento consulta gestores ativos cadastrados para a empresa e retorna `GESTOR_NAO_CADASTRADO` quando não houver destinatário válido.
- A Central atualiza a manifestação, fila e indicadores somente após resposta de sucesso do backend.
- O formatador de SLA converte timestamps numéricos em data e hora legíveis; quando `PRAZO` não for uma data válida, usa `SLA_HORAS` a partir da abertura.

## Arquivos alterados

- `api/index.js`
- `public/index.html`
- `tests/fase4-central.js`

## Testes executados

- `node tests/fase4-central.js`: aprovado.
- `node tests/nova-manifestacao-v4.js`: aprovado.
- `node tests/behavior.js`: 77 aprovados, 0 falhos.
- `node --check api/index.js` e `git diff --check`: aprovados.
- Produção, somente leitura: `GET /api/health` respondeu 200, com PostgreSQL online e Sheets acessível.

## Limitações restantes

- Operações de escrita no ambiente publicado não foram executadas: não foram usados dados reais nem houve autorização de deploy.
- A seleção de gestor depende do cadastro ativo na aba `GERENTES`; sem esse cadastro, o backend bloqueia corretamente o escalonamento para permitir regularização.
- Feriados não foram simulados: o calendário aplicável precisa estar configurado antes de afirmar cálculo em horas úteis. A correção elimina o timestamp bruto e preserva o cálculo existente em horas corridas.
