# Fase 1 — correções dos bloqueadores operacionais

Data da execução: 26/10/2026
Branch: `fix/usuarios-persistencia-edicao`
Commit-base: `1971407` (`fix: persistir edicao de acessos no cadastro administrativo`)

## Causas-raiz

### Gestão de acessos

O status usado pela autenticação podia vir do PostgreSQL antes da aba administrativa `USUARIOS`. Quando a administração alterava somente a planilha, o cache ou o registro do PostgreSQL ainda mantinha o usuário como ativo. Além disso, as rotas administrativas localizavam usuários apenas por `ID_USUARIO` ou `USUARIO`, e algumas gravações de permissões ignoravam falhas do Sheets.

### Nova manifestação

O primeiro `POST` do rascunho exigia `empresaReclamante` e `descricao`, embora o formulário ainda estivesse na etapa inicial. Isso fazia o botão `Continuar` falhar antes de os dados opcionais ou das etapas seguintes existirem. Também havia campos produzidos pela ficha que não eram enviados para o armazenamento CIRCA.

## Correções implementadas

- `verificarStatusUsuario` consulta primeiro o cadastro administrativo, reconhece e-mail/login e invalida o cache após alterações.
- Ativação, desativação, exclusão lógica e edição de permissões usam o mesmo resolvedor de identificadores e a mesma rotina de persistência.
- A persistência atualiza Sheets e PostgreSQL quando disponíveis; para usuários somente do PostgreSQL, cria o espelho administrativo antes de concluir a alteração.
- Exclusão continua lógica: grava `EXCLUIDO`, data, operador e motivo, preservando histórico; status `INATIVO`, `BLOQUEADO` e `EXCLUIDO` revogam a autenticação.
- Rascunhos de manifestação podem ser criados e avançados sem os campos finais do cliente. A validação de conclusão permanece no encerramento.
- O payload da ficha e a lista permitida do CIRCA agora preservam validação SAC, resumo da resolução e aprendizado do caso/matriz.
- O teste isolado da Fase 1 foi incluído na suíte `npm test`.

Arquivos alterados:

- `api/index.js`
- `public/index.html`
- `tests/fase1-operacional.js`
- `package.json`

## Evidências de teste

Teste isolado:

```text
FASE 1: gestão de acessos (CRUD, persistência, exclusão lógica e revogação)
e nova manifestação (rascunho, 7 etapas e finalização) aprovados em ambiente isolado.
```

O cenário isolado cobriu os 24 checks previstos para esta fase: criação, edição de perfil/empresa/setor/permissões, autorização do MASTER, rejeição de alteração por perfil comum, desativação, rejeição de sessão após desativação, reativação, validação de motivo, exclusão lógica com motivo, rejeição de sessão após exclusão, rascunho mínimo, rascunho completo, seis transições de status e finalização da sétima etapa. Os registros sintéticos são removidos do mock no encerramento.

Regressão executada com `npm test`:

- 43 testes estruturais: passou, 0 falhas, 8 pulados por ambiente externo.
- 77 testes comportamentais: passou, 0 falhas.
- 22 testes de pesquisas: passou, 0 falhas.
- 11 testes de isolamento do Portal: passou, 0 falhas.
- Testes de interface, arquivo, CIRCA, RNC e navegação: passaram.
- Smoke test com Chromium: login, abertura de Nova manifestação, preenchimento mínimo e avanço para a etapa 2 passaram.
- `node --check api/index.js` e `node --check tests/fase1-operacional.js`: passaram.

## Funcionalidades aprovadas nesta fase

Em ambiente isolado, estão aprovados o ciclo administrativo de status e permissões, a exclusão lógica com histórico, a revogação de sessão e o fluxo HTTP completo de rascunho até a etapa 7 da manifestação.

## Bloqueios restantes

Os testes locais não comprovam produção porque o ambiente não possui `DATABASE_URL`, `SPREADSHEET_ID`, credenciais do Google Drive/Sheets nem chave de IA. Por isso, permanecem pendentes a validação ponta a ponta no PostgreSQL real, gravação no Sheets real, upload no Drive, análise de IA e teste autenticado no ambiente publicado. Também permanecem os oito cenários externos já apontados na auditoria. Nenhum merge, deploy ou alteração em dados reais foi executado.
