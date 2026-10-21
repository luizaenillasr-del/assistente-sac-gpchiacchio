# Pesquisas de satisfação integradas ao Portal do Cliente

## Auditoria e estratégia

A ferramenta já utiliza `PESQUISA_QUESTIONARIO` (perguntas e versões),
`PESQUISA_RESPOSTAS`, `PESQUISA_TOKENS`, `PESQUISA_OCORRENCIAS` e
`PESQUISA_HISTORICO` no Google Sheets. Existem versões globais antigas e
versões por empresa. As respostas históricas têm colunas de atendimento,
prazo, qualidade e recomendação; o PostgreSQL pode funcionar como espelho.
O questionário público anterior e o editor interno tinham caminhos distintos.

A implementação mantém essas abas e integra a tela existente
**Pesquisa de Satisfação** com três áreas: gerenciamento, editor e resultados.
Não há migração destrutiva nem regravação de respostas antigas. Os relatórios,
notificações e envios anteriores continuam acessíveis na seção de resultados.
O HTML fornecido serve de referência visual; seu runtime de demonstração e
seus dados simulados não são utilizados no produto.

## Uso

1. Acesse **Pesquisa de Satisfação → Gerenciar pesquisas**.
2. Escolha uma pesquisa existente ou crie um rascunho para a empresa autorizada.
3. Edite textos, cores, marca, perguntas, opções, obrigatoriedade e condições.
4. Confira a prévia e clique em **Publicar alterações**.
5. Compartilhe a URL da pesquisa ou gere um convite individual.
6. Consulte respostas e indicadores em **Resultados das pesquisas**, com filtros
   por empresa, pesquisa e período.

As perguntas vinculadas aos indicadores existentes conservam seus identificadores
e vínculos. Seus enunciados podem ser editados e sua posição pode mudar; remover
essas perguntas ou trocar seus vínculos é bloqueado para preservar os indicadores.
As demais perguntas podem ser adicionadas, removidas e reordenadas. Condições
referenciam perguntas anteriores, evitando dependências circulares.

## Publicação e histórico

URLs públicas estáveis: `/portal/pesquisas/chiacchio`,
`/portal/pesquisas/plaschio`, `/portal/pesquisas/tubahia` e
`/portal/pesquisas/<identificador>` para pesquisas adicionais.
Os links antigos `/pesquisa/<token>` continuam aceitos.

Cada salvamento acrescenta uma versão a `PESQUISA_QUESTIONARIO`; rascunhos não
substituem a versão pública. Publicar, desativar ou arquivar não apaga versões.
Os leitores públicos consultam o estado persistido sem cache de resposta HTTP:
após o deploy inicial desta implementação, publicar alterações no editor não
exige novos deploys. Uma página já aberta conserva a versão carregada; reabrir
carrega a publicação atual. Convites individuais permanecem na versão emitida.

Cada nova resposta guarda `FORMULARIO_ID`, `VERSAO_ID`, `VERSAO`,
`RESPOSTAS_JSON` e `FORMULARIO_JSON` com o retrato público da versão respondida.
As colunas legadas continuam preenchidas para os indicadores existentes.
Respostas antigas continuam interpretadas pelas suas colunas originais.
O espelho PostgreSQL complementa a leitura; os metadados do Sheets prevalecem.

## Permissões e envio

A administração exige sessão, permissão de pesquisa e perfil SAC autorizado;
MASTER acessa todas as empresas. Outros usuários ficam limitados às empresas
autorizadas na sessão e às permissões existentes. Gestores, diretoria e demais
perfis de consulta recebem resultados conforme suas permissões. As APIs antigas
de edição também passam pelo mesmo controle de empresa.

A API pública retorna somente a definição publicada, sem autores, histórico,
configurações internas ou dados de outros respondentes. O servidor valida os
tipos, limites, opções, versão e condições; respostas ocultas são ignoradas.
O limite público existente de 5 requisições/minuto por IP é mantido.

Convites verificam empresa, formulário, versão, validade e marcadores de resposta.
Novos convites reservam uma linha de resposta antes de emitir o token; o envio
preenche essa linha, inclusive entre instâncias concorrentes. Reservas não entram
nos indicadores. Repetições do mesmo envio usam identificador determinístico;
reutilização com respostas diferentes é recusada. Convites antigos continuam
usando a verificação do registro e do token já respondido.

O Sheets não oferece transações nem compare-and-swap. O bloqueio de edições
simultâneas usa a revisão-base e serialização por instância, sem promessa de
transação distribuída. IDs determinísticos e verificações de existência permitem
retomar operações interrompidas; os relatórios deduplicam pelo ID de resposta.

## Insatisfação e indicadores

Preserva-se o limite existente **nota ≤ 6** (configurável por
`PESQUISA_NOTA_CRITICA`), inclusive nota zero. NPS conserva promotores 9–10,
neutros 7–8 e detratores 0–6. O envio registra uma ocorrência pendente;
não cria manifestação automaticamente. O SAC escolhe o encaminhamento e informa
justificativa. Ao transformar em manifestação, ela recebe
`AGUARDANDO_APROVAÇÃO`, com vínculo na resposta e na fila de aprovação existente.

## Verificação

`npm test` executa as suítes existentes e `tests/pesquisas.js`.
Foram verificados autenticação, escopo entre empresas, reutilização de perguntas,
rascunhos, publicação, prévia sem gravação, histórico, condições, tipos de
resposta, nota zero/NPS, períodos legados, convites/validade/duplicação, arquivamento
e decisão humana com encaminhamento à aprovação.

Também foi exercitado em Chromium o fluxo interno de login, seleção, edição,
prévia e publicação; abertura anônima em tela móvel; resposta pública com nota
zero; consulta dos indicadores e encaminhamento à aprovação. Esses testes usam
a base simulada do projeto, sem gravar dados reais de clientes.
