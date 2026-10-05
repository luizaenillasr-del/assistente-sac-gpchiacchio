# Mapeamento das Fichas: campo da ficha -> campo no sistema

Tela: `public/fichas.html` (aberta de `index.html` por `<a href="/fichas.html" target="_blank">`, em "Modelos de ficha (nova e antiga)").
Os 3 modelos (8 paginas A4) estao em branco, para imprimir ou salvar em PDF. A geracao da ficha preenchida e o armazenamento do PDF ainda nao existem para os modelos novos (ver secao 5).

Fontes consultadas: `prisma/schema.prisma` e `api/index.js`. Importante: o dado operacional ainda e gravado principalmente no Google Sheets (abas `MANIFESTACOES`, `BANCO_RNC`, `FICHAS_BIBLIOTECA`, `EVIDENCIAS`, `ANEXOS`, `FILA_APROVACAO`, `RNC_EVENTOS`, tratativas/devolutivas via `tratativaEngine` e `devolutivaEngine`). O Prisma/Postgres e um espelho parcial (dual-write). A coluna "Sistema" cita o campo do Sheets e, quando existe, o do Prisma.

Legenda: EXISTE / PARCIAL (existe de forma diferente ou so em parte) / NAO EXISTE.

## 1. Modelo 1: Ficha de Manifestacao FR-SAC-01 (paginas 1-2)

### Cabecalho
| Campo da ficha | Campo no sistema | Situacao | O que falta |
|---|---|---|---|
| Nº MAN-______ | `MANIFESTACOES.ID_MANIFESTACAO` (ex. MAN-0142) / `Manifestacao.protocolo` | EXISTE | Nada |
| Abertura __/__/____ __:__ | `DATA_ABERTURA` / `DATA_REGISTRO` / `Manifestacao.dataAbertura` | EXISTE | Nada |

### 1. Dados do cliente
| Campo | Sistema | Situacao | Falta |
|---|---|---|---|
| Razao social | `EMPRESA_RECLAMANTE` (Sheets); `Cliente.nome` (Prisma, "hoje apenas CONTATO textual") | PARCIAL | Nao ha cadastro de cliente por razao social; so texto livre |
| CNPJ | `CNPJ` (POST /api/manifestacoes e RCA); nao e gravado pelo portal publico (`/api/public/reclamacoes`) nem existe em `Cliente` | PARCIAL | Coluna CNPJ no Prisma `Cliente`; gravar CNPJ no portal publico |
| Codigo do cliente | nenhum | NAO EXISTE | Campo `codigoCliente` (ERP) em Cliente/Manifestacao |
| Nome do contato | `CONTATO` / `NOME_CLIENTE` / `CLIENTE_NOME` | EXISTE | Padronizar a coluna (3 variantes) |
| Telefone | `TELEFONE` | EXISTE | Nada |
| E-mail | `EMAIL` | EXISTE | Nada |
| Cidade/UF | nenhum na manifestacao (CIDADE existe so em tabela de prazos logisticos) | NAO EXISTE | Colunas `CIDADE`, `UF` em Manifestacao/Cliente |

### 2. Dados da manifestacao
| Campo | Sistema | Situacao | Falta |
|---|---|---|---|
| Empresa: Chiacchio / Plaschio / Cesbap / Outra | `EMPRESA_RECLAMADA`, `Empresa` (Chiacchio Embalagens, Plaschio, Tubahia) | PARCIAL | "Cesbap" nao e empresa do sistema (o sistema usa Tubahia). Confirmar com a Qualidade; a ficha mantem "Cesbap" exatamente como no mockup |
| Canal de entrada: Telefone, WhatsApp, E-mail, Presencial, Site, Representante, Pesquisa de satisfacao | `CANAL` (texto livre; portal usa Telefone/WhatsApp/E-mail/Presencial/Comercial/Outro; RCA grava "RCA") | PARCIAL | Lista controlada com as 7 opcoes da ficha; hoje ha "Comercial" e "Outro" no portal e faltam Site/Representante/Pesquisa de satisfacao |
| Tipo: Reclamacao, Solicitacao, Sugestao, Elogio, Duvida, Denuncia | `TIPO` (RECLAMACAO / SAC / SUGESTAO / ELOGIO / INFORMACAO; portal: Reclamacao, Duvida, Sugestao, Elogio) | PARCIAL | Faltam Solicitacao e Denuncia; "Duvida" x "INFORMACAO" precisa de de-para |
| Descricao da manifestacao do cliente | `DESCRICAO` / `DESCRICAO_ORIGINAL` / `Manifestacao.descricao` | EXISTE | Nada |
| Produto | `PRODUTO` / `Manifestacao.produtoNome` | EXISTE | Nada |
| Pedido | `PEDIDO` (portal publico); nao ha no POST /api/manifestacoes nem no Prisma | PARCIAL | Coluna `pedido` no Prisma; incluir no cadastro interno |
| NF | `NFE` / `NOTA_FISCAL` (portal grava `NFE`) | EXISTE | Nao esta no Prisma |
| Lote | `LOTE` | EXISTE | Nao esta no Prisma |
| Data de entrega | `DATA_ENTREGA_PREVISTA` (so lido pelo motor de atraso, nao gravado por tela) | NAO EXISTE | Campo e tela de entrada |
| Transportadora | nenhum campo gravado (so palavra-chave no motor de atraso) | NAO EXISTE | Campo `transportadora` |
| Vendedor | nenhum | NAO EXISTE | Campo `vendedor` |
| Representante | `CODIGO_RCA` (manifestacoes abertas por RCA) | PARCIAL | Nome do representante em manifestacoes de outros canais |
| Quantidade envolvida | `QUANTIDADE` | EXISTE | Nao esta no Prisma |
| Evidencias anexadas: Fotos, PDF, Video, Prints, Documentos, Audio · Qtde | aba `EVIDENCIAS` (nome, TIPO_MIME, DRIVE_URL, DESCRICAO, ORDEM); `TOTAL_EVIDENCIAS` | PARCIAL | Classificacao por tipo (Foto/Video/Print/Audio...) so pelo MIME; contagem por tipo precisa ser calculada |

### 3. Analise da IA e validacao do SAC
| Campo | Sistema | Situacao | Falta |
|---|---|---|---|
| Categoria / Motivo: sugestao da IA | `analise` (executarAnalise); `TIPO_SUGERIDO`, `Manifestacao.categoria`, `MOTIVO` | PARCIAL | Sugestao e decisao nao ficam em colunas lado a lado |
| Causa / Subcausa | `CAUSA_RAIZ` (cerebro), `subcategoria` | PARCIAL | Idem |
| Setor responsavel | `SETOR_SUGERIDO`, `SETORES_CONFIRMADOS` | EXISTE | Nada |
| Prioridade | `PRIORIDADE` | EXISTE | Nada |
| Decisao do SAC | `assertividadeService.registrarDecisao` (ACEITA/EDITADA/REJEITADA) + `STATUS_TRATATIVA` | PARCIAL | Decisao e registrada em tratativa/devolutiva, nao por campo (Categoria, Causa, Setor, Prioridade) |
| Aceita / Editada / Rejeitada (A/E/R) | mesmos valores em `/tratativa/decisao` (ACEITA/EDITADA/REJEITADA) | PARCIAL | Um valor por tratativa, nao por linha da tabela |
| Reincidente? · Ocorrencias | `Reincidencia.nivel/quantidade` (Prisma); `REINCIDENTE` (assertividade) | EXISTE | Expor na ficha |
| Casos similares (nº) | `POST /api/analise/similares` (cerebroService) | EXISTE | Persistir a contagem na manifestacao |
| Procedencia: Sim/Nao/Parcial | `PROCEDENCIA` em `TRATATIVAS` | EXISTE | Valores a conferir |
| Motivo da divergencia com a IA / justificativa | `motivoEdicao` em `registrarDecisao`; `OBSERVACOES_APROVACAO` | PARCIAL | Campo unico de justificativa da procedencia |

### 4. Encaminhamento
| Campo | Sistema | Situacao | Falta |
|---|---|---|---|
| Setor principal / setores de apoio | `SETOR_SUGERIDO`, `SETORES_SUGERIDOS`, `SETORES_CONFIRMADOS` | EXISTE | Diferenciar principal x apoio |
| Data de encaminhamento | `DATA_INICIO_TRATATIVA` (aprox.) | PARCIAL | Campo `DATA_ENCAMINHAMENTO` |
| Prazo (SLA) / data limite | `SLA_HORAS`, `Manifestacao.prazoFinal`, `SlaConfig` | EXISTE | Nada |

### 5. Tratativa do setor (um bloco por setor acionado)
| Campo | Sistema | Situacao | Falta |
|---|---|---|---|
| Setor / Responsavel | `Tratativa.setorId`, `TRATATIVAS.SETOR_RESPONSAVEL/RESPONSAVEL` | EXISTE | Nada |
| Data da resposta | nenhum campo dedicado (`DATA_CONCLUSAO_TRATATIVA`, `Tratativa.atualizadaEm`) | PARCIAL | `dataResposta` por setor |
| O que aconteceu? | `Tratativa.diagnostico` / `PROBLEMA` | PARCIAL | Pergunta estruturada separada |
| Qual foi a causa da ocorrencia? | `CAUSA_RAIZ` / `RncInvestigacao.causaRaiz` | PARCIAL | Idem, por setor |
| Como o caso foi resolvido para este cliente? | `TRATATIVA_REALIZADA`, `Tratativa.resultado` | PARCIAL | Idem |
| Acao para evitar novas ocorrencias · responsavel · prazo | `TratativaAcao` (descricao, responsavel, prazo) / `TRATATIVA_ACOES` | EXISTE | Marcar o tipo "preventiva" |
| Responsabilidade do setor: Sim/Nao/Parcial | `RESPONSABILIDADE` em `TRATATIVAS` | PARCIAL | Valores Sim/Nao/Parcial |
| Comunicar a Qualidade: Sim/Nao | `NECESSITA_RNC` (nao e o mesmo conceito) | NAO EXISTE | Campo `comunicarQualidade` |
| Status: Resolvida / Aguardando terceiro / Aguardando cliente | `STATUS_ACAO` tem AGUARDANDO_CLIENTE e AGUARDANDO_SETOR, CONCLUIDA | PARCIAL | "Aguardando terceiro" e "Resolvida" como estados da tratativa do setor |
| Varios setores = varios blocos 5 | `Tratativa` e 1:N com a manifestacao (Prisma) | PARCIAL | Gerador do PDF com um bloco por setor |

### 6. Aprovacoes
| Campo | Sistema | Situacao | Falta |
|---|---|---|---|
| Item a aprovar | `FILA_APROVACAO.DESCRICAO`, `TIPO_ENTIDADE` | EXISTE | Tipificar (reposicao/devolucao/compensacao/resposta) |
| Aprovacao (tipo/valor) | `HISTORICO_APROVACAO.DECISAO`; `VALOR` na manifestacao | PARCIAL | Valor da aprovacao por item |
| Aprovador · data | `NOME_APROVADOR`, `DATA_DECISAO` | EXISTE | Nada |

### 7. Devolutiva ao cliente
| Campo | Sistema | Situacao | Falta |
|---|---|---|---|
| Texto sugerido pela IA: Aceito/Editado/Rejeitado | `Devolutiva.textoIa`, `editada`, `status`; `/api/devolutivas/:id/decisao` (APROVADA/EDITADA/REJEITADA) | EXISTE | Rotulos |
| Canal: WhatsApp/E-mail/Telefone/Carta | nenhum campo de canal da devolutiva | NAO EXISTE | Campo `canalDevolutiva` |
| Texto final enviado | `Devolutiva.textoFinal` / `DEVOLUTIVA_FINAL` | EXISTE | Nada |
| Responsavel | `Devolutiva.usuarioId` | EXISTE | Nada |
| Data de envio | `DATA_DEVOLUTIVA`; `Devolutiva.status = ENVIADA` | PARCIAL | Data propria de envio |
| Confirmacao de envio | `DEVOLUTIVA_ENVIADA` | EXISTE | Nada |

### 8. Encerramento e historico
| Campo | Sistema | Situacao | Falta |
|---|---|---|---|
| Cliente informado: Sim/Nao | nenhum campo dedicado (ver `DEVOLUTIVA_ENVIADA`) | PARCIAL | Campo explicito |
| Manifestacao resolvida: Sim/Nao | `STATUS` (ENCERRADA) | PARCIAL | Distinguir resolvida x encerrada |
| Data de finalizacao | `DATA_CONCLUSAO_MANIFESTACAO`, `dataEncerramento` | EXISTE | Nada |
| Follow-up previsto | nenhum | NAO EXISTE | Campo `followUp` |
| Etapas Aberta, Analisada, Encaminhada, Em tratativa, Devolutiva, Finalizada · data/hora · responsavel | `ManifestacaoHistorico` (campo, usuario, criadoEm), `LOG_SISTEMA` | PARCIAL | Mapa dos eventos do historico para as 6 etapas |

## 2. Modelo 2: Ficha de Encaminhamento de Manifestacao (pagina 3, oficial em uso)

Textos mantidos identicos ao original. E o mapa de importacao de fichas antigas (`POST /api/biblioteca/importar-ficha`).

| Campo da ficha | Sistema | Situacao | Falta |
|---|---|---|---|
| Data do Registro | `FICHAS_BIBLIOTECA.DATA_REGISTRO` | EXISTE | Nada |
| Setor (SAC) | `SETOR_RECEBIMENTO` | EXISTE | Nada |
| Nº Reclamacao | `PROTOCOLO` | EXISTE | Nada |
| Atendente | `COLABORADOR_RECEBIMENTO` | EXISTE | Nada |
| Canal de Atendimento (Telefone, WhatsApp, E-mail, Presencial, Pesquisa de Satisfacao, Outro) | `MANIFESTACOES.CANAL`; nao existe em `FICHAS_BIBLIOTECA` | PARCIAL | Coluna `CANAL` na biblioteca e na importacao |
| Nome do Cliente | `NOME_CLIENTE` | EXISTE | Nada |
| Empresa / Razao Social | `EMPRESA` | EXISTE | Nada |
| CNPJ | nao existe em `FICHAS_BIBLIOTECA` | NAO EXISTE | Coluna e extracao |
| Telefone / WhatsApp, E-mail | em `MANIFESTACOES` (`TELEFONE`, `EMAIL`); nao na biblioteca | PARCIAL | Colunas na biblioteca e na importacao |
| Tipo (Reclamacao, Duvida, Sugestao, Elogio) | `TIPO_MANIFESTACAO` | EXISTE | Nada |
| A reclamacao e procedente? Sim/Nao/Parcialmente · Justifique | `PROCEDENCIA` (tratativa); nao na biblioteca | PARCIAL | Colunas `PROCEDENTE` e `JUSTIFICATIVA` |
| Descricao Detalhada | `DESCRICAO` (manifestacao); a biblioteca guarda so `MOTIVO` | PARCIAL | Coluna `DESCRICAO` |
| Produto, Lote, NFe | em `MANIFESTACOES` (`PRODUTO`, `LOTE`, `NFE`); nao na biblioteca | PARCIAL | Colunas na biblioteca |
| Data de Encaminhamento | nao existe | NAO EXISTE | Coluna |
| Prazo para Retorno ao SAC: 72 horas. | texto fixo na ficha; `SLA_HORAS` na manifestacao | EXISTE | Nada |
| Resposta do Setor (4 perguntas + responsavel e prazo da acao) | `TRATATIVA_REALIZADA`, `CAUSA_RAIZ`, `TratativaAcao` | PARCIAL | Mapear 1:1 as 4 perguntas |
| Data de Retorno ao Cliente, Cliente Informado, Manifestacao Resolvida, Observacoes Finais | `DATA_DEVOLUTIVA`, `DEVOLUTIVA_ENVIADA`, `STATUS`, `OBSERVACOES` | PARCIAL | Colunas na biblioteca |

## 3. Modelo 3: RNC RT-0001 (paginas 4-8)

Sistema atual: `BANCO_RNC` (Sheets), `Rnc`, `RncInvestigacao`, `RncAcao`, `RncEficacia` (Prisma), `RNC_EVENTOS`, `ANEXOS`. Rotas: `GET/POST /api/rnc`, `GET /api/rnc/:id`, `PATCH /api/rnc/:id/execucao`, `POST /api/anexos`.

| Campo da ficha | Sistema | Situacao | Falta |
|---|---|---|---|
| Cabecalho: Empresa | `BANCO_RNC.EMPRESA` / `Rnc.empresaId` | PARCIAL | Ficha fixa em "Chiacchio Embalagens" como no mockup. Confirmar se muda conforme a empresa da RNC |
| RT-0001 Rev: 0000, Criado, Aprovado, Data 20/03/26, "N de 5" | texto fixo do documento controlado | EXISTE (fixo) | Controle de versao do documento |
| EMITIDA POR | `USUARIO_CRIACAO` | EXISTE | Nada |
| RECEBIDO POR | nenhum (so eventos `VISUALIZOU`) | NAO EXISTE | Campo |
| DATA VERIFICACAO | nenhum | NAO EXISTE | Campo |
| N° RNC | `ID_RNC` / `Rnc.protocolo` | EXISTE | Nada |
| SETOR | `SETOR` | EXISTE | Nada |
| LOTE | nenhum na RNC (existe na manifestacao vinculada) | PARCIAL | Campo `lote` em Rnc |
| OPERADOR | nenhum | NAO EXISTE | Campo |
| PRODUTO | `Rnc.produto` | EXISTE | Nada |
| QUANTIDADE | nenhum na RNC | NAO EXISTE | Campo |
| CLIENTE / CONTATO | via `manifestacaoId` | PARCIAL | Copiar na RNC |
| Origem: Analise critica da alta direcao, Auditoria interna, Auditoria externa, RNC externa, Inspecao interna, Avaliacao SAC | `Rnc.origemTipo`: COMERCIAL_RECLAMACAO, AUDITORIA_EXTERNA, AUDITORIA_INTERNA, DESVIO_MATERIA_PRIMA | PARCIAL | Lista nao coincide: faltam Analise critica, RNC externa, Inspecao interna, Avaliacao SAC. Atencao: a regra do sistema diz que o SAC nao gera RNC, mas a ficha oficial traz "Avaliacao SAC". Decidir com a Qualidade |
| Tipo: Real / Potencial | nenhum | NAO EXISTE | Campo |
| Plano de Acao? | nenhum | NAO EXISTE | Campo |
| Procedente? | `PROCEDENCIA` na tratativa, nao na RNC | PARCIAL | Campo na RNC |
| Devolucao? | nenhum | NAO EXISTE | Campo |
| Descricao da nao conformidade / observacao | `NAO_CONFORMIDADE` / `Rnc.descricao` | EXISTE | Nada |
| Acoes de correcao imediata (acao, responsavel, prazo) | `RncAcao` tipo CONTENCAO; `ACAO_CONTENCAO` | EXISTE | Lista de varias acoes no Sheets (hoje 1 campo) |
| Analise de causa: 5 porques (Problema 1 a 5) | `RncInvestigacao.metodologia` | NAO EXISTE | 5 campos ou lista estruturada |
| Causa raiz | `CAUSA` / `RncInvestigacao.causaRaiz` | EXISTE | Nada |
| Acao de correcao (acao, responsavel, prazo, status) | `RncAcao` tipo CORRETIVA; `ACAO_CORRETIVA`, `RESPONSAVEL_ACAO`, `PRAZO_ACAO`, `STATUS_ACAO` | EXISTE | Varias acoes no Sheets |
| Verificacao (texto) | `RESULTADO_EFICACIA` | PARCIAL | Campo de texto separado |
| Verificacao da eficacia: Conforme / Nao conforme · data | `RncEficacia.eficaz`, `DATA_EFICACIA` | EXISTE | Nada |
| Nova NC: Sim/Nao · data | nenhum | NAO EXISTE | Campos |
| Anexo de evidencia da NC (pag. 3) | `ANEXOS` (`ID_ENTIDADE`, CATEGORIA, DESCRICAO, USUARIO_UPLOAD, DATA_UPLOAD); `GET /api/anexos?idEntidade=` | PARCIAL | Vincular anexo a etapa (NC / acoes / eficacia): hoje so existe `CATEGORIA` livre |
| Evidencia das acoes (pag. 4) | idem | PARCIAL | idem |
| Evidencia da eficacia (pag. 5) | idem | PARCIAL | idem |

## 4. Resumo do que falta no backend (nao implementado nesta entrega)

1. Colunas novas em Manifestacao: Codigo do cliente, Cidade/UF, Data de entrega, Transportadora, Vendedor, Representante, Data de encaminhamento, Follow-up, Cliente informado, Canal da devolutiva; Pedido, NF, Lote, Quantidade e CNPJ no Prisma.
2. Listas controladas: canais (7 opcoes da ficha), tipos (incluir Solicitacao e Denuncia), empresas (Cesbap x Tubahia).
3. Tratativa por setor com perguntas estruturadas, Comunicar a Qualidade e Status (Resolvida, Aguardando terceiro, Aguardando cliente).
4. RNC: Recebido por, Data de verificacao, Operador, Quantidade, Tipo (Real/Potencial), Plano de acao, Devolucao, Nova NC, 5 porques e varias acoes por tipo; origens da ficha oficial; vinculo de anexo com a etapa.
5. Biblioteca (`FICHAS_BIBLIOTECA`): colunas de canal, CNPJ, contato, descricao, produto, lote, NFe, procedencia, datas, para a importacao do Modelo 2.

## 5. Geracao e armazenamento do PDF (IMPLEMENTACAO-FICHAS, secao 5)

| Requisito | Situacao |
|---|---|
| `api/services/pdfFicha.js` | Gera uma ficha de 1 pagina em pdfkit no layout antigo ("FICHA DE RECLAMACAO / MANIFESTACAO", 5 secoes), NAO nos modelos novos. Nao foi alterado nesta entrega |
| PDF do Modelo 1 / 2 / RNC preenchido | NAO EXISTE (apenas em branco, via impressao do navegador) |
| Versionamento v1, v2 sem sobrescrever | PARCIAL: `regenerar-pdf` incrementa `VERSAO`, mas o `PDF_DRIVE_ID` atual e substituido na linha da ficha (versao anterior perde o apontamento) |
| Armazenamento persistente | PARCIAL: usa Google Drive (`uploadArquivoDrive`), nao ha hash do arquivo |
| Estrutura Empresa/Ano/Mes e nome `EMPRESA_AAAA-MM-DD_PROTOCOLO_vN.pdf` | PARCIAL: ha `ANO`/`MES`/`EMPRESA`; nome atual e `FICHA_<id>.pdf` |
| Hash do arquivo e link assinado com 403 por empresa | NAO EXISTE (a listagem filtra por empresa; o download direto `/api/manifestacoes/:id/pdf` nao verifica empresa) |
| Importacao preserva o original sem alterar | NAO EXISTE: o arquivo importado nao e guardado (`PDF_DRIVE_ID` fica vazio) |
