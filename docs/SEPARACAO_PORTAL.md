# Separação do Portal do Cliente e SAC

## Auditoria

O código executado é uma SPA em `public/index.html` com Express em `api/index.js`,
publicada na Vercel; não há aplicação Next.js, configuração TypeScript nem projeto
Apps Script versionado neste checkout. Não se modifica uma integração externa de
Apps Script. A persistência e os serviços Google existentes são reutilizados.

| Responsabilidade | Arquivos atuais | Publicação |
| --- | --- | --- |
| SAC, login e administração do portal | `public/index.html`, `public/assets/pesquisas-admin.*`, `public/assets/portal-links.js` | Somente projeto interno |
| Portal público | `public/portal.html` | Copiado como `portal-cliente/dist/index.html` |
| Formulário público/prévia | `public/assets/pesquisa-formulario.*` | Compartilhado, sem código administrativo |
| Marcas e fontes | Lista explícita em `portal-cliente/policy.js` | Somente os arquivos necessários |
| API, permissões, Sheets/Drive e aprovação | `api/index.js`, `server-routes/pesquisas.js`, serviços existentes | Projeto interno |
| Rotas externas e build estático | `portal-cliente/vercel.json`, `portal-cliente/scripts/build.js` | Segundo projeto |

O `vercel.json` da raiz é do projeto interno e continua no mesmo local. Seu fallback
servia a SPA interna para caminhos desconhecidos. A rota Express `/` também tinha
um redirecionamento antigo para uma pesquisa; ela passa a servir a página de acesso
interna existente, sem substituir o HTML da landing page.

Não existe configuração `.vercel/project.json` disponível neste checkout, nem
conector/credencial Vercel para consultar as configurações dos projetos. O nome e
a disponibilidade do novo domínio precisam ser confirmados no painel. O deploy
anterior de `main` foi reportado como falho; os avisos de submódulos e npm enviados
não identificam, por si só, o erro fatal. Este trabalho não afirma que aquele
deploy foi reparado ou que uma nova publicação foi realizada.

## Plano implementado

1. Segundo projeto estático no mesmo repositório e mesma branch, com Root Directory
   `portal-cliente`. Não contém funções, página de login, dashboard nem arquivos de
   administração. O build copia uma lista explícita de arquivos públicos; não copia
   o diretório `public` inteiro nem instala as dependências do SAC.
2. Rotas externas com métodos e caminhos exatos para as APIs públicas necessárias.
   A Vercel encaminha essas operações ao backend atual. Não existe proxy genérico
   para `/api/*`; rotas não permitidas retornam 404, inclusive com token Master.
3. URLs geradas pelo backend usam `PORTAL_PUBLIC_URL` quando configurada. A listagem
   de pesquisas, convites, botões de abrir/copiar links e administração do portal
   apontam para esse endereço. Sem a variável, os links existentes continuam no
   domínio interno durante a transição.
4. Consulta de protocolo com respostas mínimas, proteção contra enumeração e
   confirmação adicional para identificadores antigos.
5. Testes com dois servidores locais e mesma base simulada. Nenhuma gravação real,
   merge em `main` ou publicação em produção está autorizada nesta etapa.

## Fluxo e limites de segurança

O navegador chama `/api/...` na própria origem pública. As rotas permitidas são
encaminhadas ao domínio fixo `https://assistente-sac-gpchiacchio.vercel.app`;
cliente e parâmetros não escolhem o host de destino. Métodos incorretos, login,
solicitação de acesso de colaborador, configurações, arquivos internos e APIs
administrativas não são publicados no projeto externo. O mesmo backend mantém
validação dos campos, permissões, empresas, controle de convites e rate limit.

A URL interna continua acessível diretamente e apresenta seu login, como previsto
para colaboradores. A autenticação das APIs é o controle de acesso aos dados;
conhecer o endereço interno não dá acesso ao SAC. O projeto público não incorpora
esse login. Não se configura cookie compartilhado entre os dois domínios; o portal
usa `credentials: 'omit'`, sem token administrativo ou segredo no navegador.

Os arquivos públicos recebem CSP com conexões somente à própria origem,
`X-Frame-Options: DENY` e `Referrer-Policy: no-referrer`. APIs e páginas do portal
não são armazenadas em cache HTTP. Os assets são compartilhados pelo código-fonte,
mas somente os arquivos da lista permitida entram na saída pública.

Novos protocolos têm prefixo CHI/PLAS/TUB e 96 bits aleatórios; sua posse permite
consultar o resumo autorizado. Devem ser tratados como informação privada.
Protocolos antigos/sequenciais exigem protocolo **e** e-mail ou telefone completo
já cadastrado. Essa confirmação é conhecimento de contato, não OTP nem login de
cliente. Sem contato cadastrado, o cliente precisa do atendimento do SAC; o
registro e o acesso interno não são apagados. Protocolo inexistente e confirmação
incorreta devolvem a mesma resposta 404. O contato vai no corpo de um POST, nunca
na URL de consulta. O GET anterior continua funcionando para protocolos aleatórios
do portal, mas bloqueia identificadores sequenciais sem confirmação.

O endpoint adicional `POST /api/public/protocolo/consultar` justifica-se pela
proteção dos protocolos legados e evita dados de contato em query strings. A
resposta mantém os campos públicos anteriores; não retorna descrições internas,
nomes, documentos, contatos, anexos, análises ou causas. A devolutiva continua
exigindo encerramento e `DEVOLUTIVA_ENVIADA`, conforme a regra anterior.
O rate limit existente é por IP e por instância; não é um bloqueio distribuído.

## Configuração na Vercel — somente após autorização

Não criar/publicar o segundo projeto nem fazer merge antes da aprovação da usuária.
A importação de um projeto pode iniciar um deploy automaticamente.

### 1. Preparar o projeto interno

Após revisar e autorizar o PR, incorporar a implementação e publicar o backend do
SAC primeiro, preservando seu projeto e domínio atuais. A publicação anterior com
falha precisa estar resolvida; verificar o primeiro erro fatal nos Build Logs.
Não acrescentar `PORTAL_PUBLIC_URL` antes de o portal externo estar disponível.

Manter as variáveis e credenciais existentes **somente no projeto interno**:
`APP_URL`, `SESSION_SECRET`, `SPREADSHEET_ID`, `GOOGLE_CREDENTIALS`; quando já
utilizadas, preservar também `PESQUISA_SPREADSHEET_ID`, `DRIVE_FOLDER_ID`,
`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `PG_LEITURA_ATIVA`, `RESEND_API_KEY`,
`EMAIL_FROM`, `OPENAI_API_KEY`, `AI_PROVIDER=openai` e `PESQUISA_NOTA_CRITICA`.
`APP_URL` continua sendo `https://assistente-sac-gpchiacchio.vercel.app`.
Não duplicar Sheets, banco, service account ou cadastros. Não executar o postinstall
que contém `prisma db push --accept-data-loss`; manter o install command seguro já
versionado no `vercel.json` da raiz.

### 2. Criar o projeto público

No painel Vercel, após autorização: **Add New → Project → importar**
`luizaenillasr-del/assistente-sac-gpchiacchio` novamente.

| Campo | Valor |
| --- | --- |
| Project Name | `portal-cliente-gpchiacchio` (confirmar disponibilidade) |
| Framework Preset | Other |
| Root Directory | `portal-cliente` |
| Include source files outside of the Root Directory in the Build Step | Habilitado, para ler os arquivos públicos compartilhados |
| Install Command | `node --version` |
| Build Command | `node scripts/build.js` |
| Output Directory | `dist` |
| Node.js Version | 20.x, alinhada à CI |
| Production Branch | `main`, após aprovação e merge |
| Configuração | `portal-cliente/vercel.json`, detectada pelo Root Directory |

Não usar `design_mockup`, `public` nem a raiz do repositório como Root Directory
nesse projeto. Não copiar o `vercel.json` da raiz para o novo projeto. Se houver
filtros para ignorar builds, permitir alterações em `portal-cliente/**`,
`public/portal.html` e nos assets compartilhados; deixá-los desativados inicialmente.

**Variáveis necessárias no projeto público: nenhuma.** O host do backend está
fixado nas rotas versionadas. Não importar variáveis do projeto interno. Não
cadastrar `DATABASE_URL`, `GOOGLE_CREDENTIALS`, `SESSION_SECRET`, chaves de IA ou
credenciais administrativas. O site estático apenas encaminha as chamadas
explicitamente autorizadas; segredos continuam no backend.

Confirmar o deploy **Ready** e associar o domínio
`portal-cliente-gpchiacchio.vercel.app` a esse projeto. Se Deployment Protection
exigir login na produção, ajustar o ambiente de produção para acesso público; as
permissões do SAC continuam no backend. Previews podem manter proteção. Confirmar
também que o autor do commit possui acesso à equipe Vercel, caso o check reporte
esse bloqueio, como ocorreu na prévia anterior.

### 3. Trocar os links gerados pelo SAC

Depois de validar a página pública, adicionar **no projeto interno**, para o
ambiente Production:

```text
PORTAL_PUBLIC_URL=https://portal-cliente-gpchiacchio.vercel.app
```

A origem precisa ser HTTPS, distinta do SAC, sem caminho, query ou credenciais.
Não configurar `APP_URL` com o domínio do portal. Fazer novo deploy do projeto
interno para aplicar a variável; os links da administração e os convites passarão
a usar a origem pública. O domínio exato é incluído no CORS do backend, sem wildcard
para portais de terceiros. O proxy do portal evita dependência de acesso direto
entre origens no navegador.

Os caminhos antigos `/portal`, `/portal.html` e `/pesquisa/...` do SAC permanecem
compatíveis durante a transição; o novo endereço é usado nos links gerados.
Não se cria redirecionamento para um projeto ainda inexistente. No domínio público,
remover `/pesquisas/...` leva à raiz do portal; rotas internas desconhecidas dão 404.

### 4. Verificação e reversão

Conferir SHA do deploy, domínio e estado Ready dos dois projetos. Validar as nove
situações pedidas antes de comunicar a disponibilidade. Previews deste projeto
público também têm rotas para o backend real; os testes automatizados desta mudança
usam apenas o simulador local, sem enviar manifestações a produção.

Para reverter a troca dos links sem perda de dados, remover `PORTAL_PUBLIC_URL` do
projeto interno e reaplicar o deploy anterior aprovado. O endereço antigo permanece
compatível; respostas e manifestações ficam na mesma base, sem migração de retorno.
Reverter o deploy público afeta somente seus arquivos, sem apagar registros.

## Testes locais

```bash
# Na raiz: suíte existente e testes de isolamento
NODE_ENV=test npm test

# Terminal 1: SAC com base simulada, sem credenciais reais
APP_URL=http://127.0.0.1:3000 PORTAL_PUBLIC_URL=http://127.0.0.1:3001 node scripts/dev-mock.js

# Terminal 2: portal estático e rotas públicas para esse SAC local
node scripts/dev-portal.js
```

O simulador público aceita somente backend HTTP local; não serve como proxy para
produção. Para alterar as rotas do projeto, editar `portal-cliente/policy.js`,
gerar `node portal-cliente/scripts/build.js --config` e executar os testes.
O build verifica a correspondência entre política e configuração, limpa somente
sua própria saída e copia os arquivos explicitamente permitidos.

`tests/portal-isolamento.js` verifica pacote público, raiz e links antigos,
bloqueio de arquivos/rotas internos (inclusive com token), métodos e destinos do
proxy, login interno e permissões, URLs externas, reclamação chegando ao SAC,
protocolo/contato/privacidade, pesquisa e NPS, devolutiva autorizada, configurações
e rate limit. As suítes anteriores continuam exercitando aprovação, tratativa,
escopo de empresa e históricos. A validação local não comprova deploy nem permissões
da service account ou integrações Google de produção.

## Resultado da validação desta implementação

- `npm test`: 150 testes aprovados, zero falhas e 3 testes PostgreSQL pulados
  por dependerem de banco configurado. As últimas restrições de origem e caminhos
  também passaram novamente nos 11 testes de isolamento.
- Chromium, com SAC e portal em origens locais distintas: login interno e links
  externos, edição/publicação da pesquisa, resposta anônima em tela móvel e NPS
  interno, reclamação/consulta por protocolo, retorno à raiz e bloqueio de rota
  administrativa. Nenhum erro JavaScript nas páginas exercitadas.
- `@vercel/routing-utils@6.6.0`, instalado fora do repositório: normalização das
  22 rotas públicas sem erro. Sem dependência nova na aplicação.
- Deploy real do novo projeto, disponibilidade do domínio e integrações Google
  de produção não foram executados; dependem de autorização e configuração
  na conta Vercel.
