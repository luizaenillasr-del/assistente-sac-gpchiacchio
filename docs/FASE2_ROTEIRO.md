# Roteiro Fase 2 — Operação e Manutenção
## Guia para Responsável Não-Técnico

---

## 1. Criar novo usuário

```bash
node scripts/criarUsuario.js
```

O script vai perguntar:
1. **Usuário** (sem espaços, ex: `joao.silva`)
2. **Nome completo**
3. **E-mail**
4. **Perfil** — escolha um de: `ANALISTA SAC`, `SUPERVISOR`, `MASTER`
5. **Empresa** — escreva exatamente como está na planilha:
   - `chiacchio embalagens` → vai para CHIACCHIO
   - `plaschio` → vai para PLASCHIO
   - `tubahia` ou `cesbap` → vai para TUBAHIA
   - `grupo chiacchio` → vai para MASTER
6. **Setor** (opcional, deixe em branco para acesso global)
7. **Senha** (não aparece na tela — mínimo 6 caracteres)

O usuário criado aparece automaticamente na aba USUARIOS da planilha.

---

## 2. Auditar empresas na planilha

Verifica quais valores de empresa existem em cada aba e se estão mapeados:

```bash
node scripts/auditarEmpresas.js
```

Mostra por aba: total de registros, quantos sem empresa, e cada valor com o código canônico.  
Itens marcados como `DESCONHECIDO` precisam ser corrigidos na planilha.

---

## 3. Gerar hash de senha (redefinir senha manual)

Se precisar redefinir a senha de um usuário diretamente na planilha:

```bash
node scripts/gerarHash.js
```

O script gera o valor `sha256:...` para copiar no campo SENHA da aba USUARIOS.

---

## 4. Auditar senhas da planilha

Verifica quais usuários têm senhas sem hash (inseguras):

```bash
node scripts/auditarSenhas.js
```

Qualquer senha sem o prefixo `sha256:` deve ser substituída usando `gerarHash.js`.

---

## 5. Executar testes antes de atualizar

Sempre rodar antes de publicar uma nova versão:

```bash
npm test
```

Deve terminar com `X passou, 0 falhou`. Se houver falha, não publicar.

---

## 6. Variáveis de ambiente obrigatórias (Vercel)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `GOOGLE_CREDENTIALS` | Sim | JSON de credenciais da conta de serviço Google |
| `SPREADSHEET_ID` | Sim | ID da planilha Google Sheets |
| `SESSION_SECRET` | Sim | Segredo JWT (≥32 chars, único, nunca compartilhar) |
| `DATABASE_URL` | Não | URL Neon/PostgreSQL (deixar vazio = só Sheets) |
| `DEMO_LOGIN_ENABLED` | Não | `false` em produção |
| `PG_LEITURA_ATIVA` | Não | `false` padrão — ativa leitura PG quando `true` |

**Nunca expor estas variáveis no frontend ou nos logs.**

---

## 7. Fluxo completo de uma manifestação

1. Analista SAC faz login
2. Cria manifestação (POST /api/manifestacoes)
3. Sistema analisa automaticamente (IA como sugestão, humano decide)
4. Analista revisa análise e registra decisão (POST /api/manifestacoes/:id/decisao)
5. Tratativa é aplicada e registrada (PATCH /api/manifestacoes/:id)
6. Devolutiva é gerada e enviada ao cliente
7. Se necessário, item vai para fila de aprovação (POST /api/fila-aprovacao)
8. Aprovador decide (POST /api/fila-aprovacao/:id/decidir)
9. Manifestação é encerrada (PATCH status=ENCERRADA)
10. LOG_SISTEMA registra toda a auditoria

**RNC nunca é gerada automaticamente — apenas por decisão humana.**
