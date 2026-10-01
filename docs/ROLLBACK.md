# Procedimento de Rollback

## Rollback via Vercel (recomendado — mais rápido)

1. Acessar https://vercel.com/dashboard → projeto `assistente-sac-gpchiacchio`
2. Ir em **Deployments**
3. Localizar o último deployment estável (anterior ao problema)
4. Clicar nos três pontos (⋯) → **Promote to Production**
5. Confirmar — o sistema volta ao estado anterior em ~30 segundos

## Rollback via Git

Identificar o commit estável anterior:

```bash
git log --oneline -10
```

Criar branch de rollback a partir desse commit:

```bash
git checkout -b hotfix/rollback-<data> <hash-do-commit-estavel>
git push -u origin hotfix/rollback-<data>
```

Fazer deploy desse branch no Vercel:
- Settings → Git → change branch para `hotfix/rollback-<data>`
- Ou: `vercel --prod` nessa branch

## Reverter um commit específico (sem perder histórico)

```bash
git revert <hash-do-commit-problemático>
git push origin claude/great-volta-inqs1x
```

## Revert de emergência — restaurar estado do branch principal

```bash
git fetch origin main
git checkout -B claude/great-volta-inqs1x origin/main
git push --force-with-lease origin claude/great-volta-inqs1x
```

⚠️ **Usar apenas em emergência** — apaga commits do branch.

## O que NÃO fazer em rollback

- Não apagar dados da planilha Google Sheets — irreversível
- Não alterar DATABASE_URL enquanto PG_LEITURA_ATIVA=true — pode corromper estado
- Não usar `git push --force` sem `--force-with-lease`
- Não fazer rollback de SECRET SESSION sem invalidar todas as sessões ativas

## Validação pós-rollback

```bash
npm test  # deve terminar 0 falhas
curl https://assistente-sac-gpchiacchio.vercel.app/api/health
```

Resposta esperada: `{"sucesso":true,"status":"ok"}`
