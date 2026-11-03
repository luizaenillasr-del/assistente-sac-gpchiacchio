# Contrato da jornada Nova Manifestação → Ficha V2

Diagnóstico do código existente, sem acesso ao armazenamento de Production.

| Estado persistido | Etapa `ETAPA_ATUAL` | Entrada | Ação permitida | Próximo estado |
| --- | --- | --- | --- | --- |
| Sem registro | 1 em memória | Nova Manifestação | POST `/api/manifestacoes` com chave idempotente | RASCUNHO |
| RASCUNHO | 1 a 7 em `MANIFESTACOES` | Salvar, Salvar e continuar, Salvar rascunho e sair | PATCH `/api/manifestacoes/:id/circa-dados` com versão conhecida | RASCUNHO |
| RASCUNHO | 7 | Concluir preenchimento | PATCH com `finalizar`, confirmação de persistência e reserva de protocolo | AGUARDANDO_TRIAGEM_SAC |
| AGUARDANDO_TRIAGEM_SAC | operacional | Central/Ficha V2 | Triagem e encaminhamento autorizado | AGUARDANDO_RESPOSTA_SETOR ou tratativa SAC |
| Encaminhada | operacional | Ficha V2 | Acionamentos separados, resposta do setor e validação SAC | AGUARDANDO_VALIDACAO_SAC |
| Encerrada | operacional | Ficha V2 | Consulta | ENCERRADA |

O servidor guarda ID técnico, protocolo, status, etapa, versão (`DATA_ULTIMA_EDICAO`), relato original, `ANALISE_IA` e metadados de `ANEXOS` em `MANIFESTACOES` no Sheets. Acionamentos ficam em `ACIONAMENTOS_INTERNOS`; anexos também são vinculados ao Drive/abas de evidências. O frontend usa `_nmCardId`, `nmEtapa`, `_nmRascunhoUltimaEdicao` e arquivos locais ainda não enviados. `localStorage` guarda um ID auxiliar, nunca substitui a leitura do servidor na retomada.

Causas encontradas: o payload associava status operacional à etapa visual e transformava um rascunho na Etapa 3 em tratativa; a Central usava uma ação genérica de abrir Ficha V2; não havia botão visível para salvar e sair; a retomada não restringia status RASCUNHO. A Ficha V2 e o formulário têm navegação própria, mas compartilham a mesma manifestação e os mesmos endpoints. O botão superior “Salvar” mantém sua semântica de salvar no lugar; “Salvar rascunho e sair” é uma ação explícita.

A integração real Sheets/Drive/Neon e o fluxo SAC → setor → SAC exigem ambiente isolado autorizado com credenciais de teste. Testes locais que simulam a API não comprovam persistência em Production.
