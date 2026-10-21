# Portal do Cliente

A preparação do projeto público independente e o roteiro de implantação estão em
[Separação do Portal e SAC](SEPARACAO_PORTAL.md). Este documento descreve também
os caminhos compatíveis mantidos no projeto interno.

O portal é a interface externa do SAC. Não exige sessão interna e usa os mesmos registros, fila de aprovação, fichas, pesquisas e configuração administrativa da ferramenta.

O layout segue o HTML “Portal do Cliente - Grupo Chiacchio v2” fornecido como referência: cabeçalho branco, marca, três cards de navegação e formulários em seções. As fontes Montserrat e a marca foram extraídas do próprio arquivo e são servidas localmente. O runtime de demonstração e seus dados fictícios não são usados.

O formulário diferencia cliente direto (CNPJ, razão social e representante) e indireto (CPF e local da compra). A empresa do grupo também é selecionada no fluxo indireto para que o registro seja encaminhado corretamente. Esses dados ficam no registro interno; a consulta pública continua retornando apenas seu resumo autorizado. As avaliações de 1–5 do modelo são convertidas para a escala de indicadores 0–10 já usada pelo SAC, e a recomendação mantém a escala 0–10.

- `/portal` e `/portal.html`: página pública `public/portal.html`.
- `/`: ferramenta interna existente; permanece sem alterações.
- Administração: módulo **Portal do Cliente** dentro da ferramenta, restrito aos perfis existentes. Não há uma nova rota `/admin/portal`.

O formulário público envia para `/api/public/reclamacoes`. Registros originados no portal recebem `ORIGEM=PORTAL_PUBLICO` e protocolo aleatório com prefixo `CHI`, `PLAS` ou `TUB`. O mesmo identificador acompanha `MANIFESTACOES`, `FILA_APROVACAO`, `FICHAS_BIBLIOTECA` e `EVIDENCIAS`. O fluxo do portal é validado com a persistência Google Sheets; a migração PostgreSQL não foi validada nesta mudança.

A consulta publica um resumo de andamento. A resposta oficial só aparece em registros do portal encerrados com `DEVOLUTIVA_ENVIADA` preenchida. Sugestões de IA, rascunhos, análises, causas e responsabilidades internas não fazem parte da resposta pública. O protocolo deve ser guardado pelo cliente. Protocolos antigos/sequenciais agora exigem confirmação do contato cadastrado pelo POST de consulta; os identificadores e históricos internos são preservados.

Anexos: até oito fotos JPG/PNG/WebP ou PDFs, somando no máximo 3 MB para caber no limite de requisição do Vercel. São armazenados pelo serviço de Google Drive já existente, sem criar permissão pública. A equipe precisa ter acesso à pasta compartilhada configurada. Se o upload falhar, a manifestação permanece registrada e o cliente recebe um aviso para encaminhar os arquivos ao SAC usando o protocolo, sem duplicar o registro.

As configurações internas `PESQUISA_ATIVA_<EMPRESA>` e `FORM_MANIFESTACAO_ATIVO` são consultadas pelas operações públicas correspondentes. Autenticação das rotas internas e o limite público de cinco requisições por minuto por IP permanecem ativos.

## Publicação no Vercel

No projeto associado ao domínio de produção, conferir:

1. Repositório `luizaenillasr-del/assistente-sac-gpchiacchio` e Production Branch `main`.
2. Root Directory: raiz deste repositório, não `design_mockup` nem `public`.
3. Output Directory: `public`, conforme `vercel.json`.
4. Install Command: usar a configuração versionada, `npm ci --ignore-scripts && npx --no-install prisma generate`. Isso gera o cliente sem executar `prisma db push --accept-data-loss` do postinstall.
5. Preservar as variáveis de produção já configuradas. Sheets/Drive precisam de `SPREADSHEET_ID`, `GOOGLE_CREDENTIALS` e acesso da service account; a autenticação interna precisa de `SESSION_SECRET`. Não colocar valores em HTML ou no repositório. `DRIVE_FOLDER_ID` pode direcionar os anexos à pasta compartilhada da equipe.
6. Confirmar que o deployment do commit desejado terminou como **Ready** e está associado ao domínio de produção. Um merge no GitHub ou um check local não comprova publicação.

Se `/portal.html` também abrir o login interno, comparar o commit do deployment, o diretório de saída e a associação do domínio. O caminho direto precisa entregar o arquivo público antes de validar a regra de `/portal`. Não substituir a landing page interna para contornar uma publicação incorreta.

## Validação

Executar `npx --no-install prisma generate` e `NODE_ENV=test npm test`. Os testes comportamentais usam Sheets/Drive simulados e não fazem gravações em produção.

Para validar a interface local, iniciar `node scripts/dev-mock.js` e verificar `/portal` em um navegador: formulário, anexo, protocolo e acompanhamento. Os dados são descartáveis. Este modo não comprova acesso ao Google Sheets/Drive de produção.

No endereço de produção, `/portal` e `/portal.html` devem ter o título **Portal do Cliente — Grupo Chiacchio**, sem redirecionar para login. A raiz deve continuar sendo a ferramenta interna. As rotas `/api/portal-admin/*` devem exigir sessão. Só registrar dados reais ou testes em produção com autorização específica.
