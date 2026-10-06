# Assistente SAC · Grupo Chiacchio
## Especificação do protótipo, tela por tela e passo a passo

Este documento descreve o protótipo entregue (HTML) para servir de base à implementação no sistema definitivo. Ele explica cada tela, cada botão, as regras de negócio aplicadas e o que hoje é apenas simulado.

---

## 0. Visão geral

**Propósito:** registrar, analisar, encaminhar, tratar e acompanhar cada manifestação do SAC em um único lugar, com rastreabilidade (ISO 9001) e histórico permanente. A IA **auxilia** a análise; a decisão é sempre de uma pessoa do processo.

**Fluxo principal de uma manifestação:**
1. SAC registra a manifestação e a IA auxilia na análise.
2. Analista valida e encaminha ao setor responsável.
3. Setor registra a tratativa; aprovação quando necessária.
4. SAC envia a devolutiva ao cliente; a manifestação é finalizada e fica no histórico.

**Regra fixa:** reclamação registrada pelo SAC **não gera RNC**. Ela segue a Ficha de Encaminhamento de Manifestação e a tratativa dos setores.

### Arquivos do projeto

| Arquivo | Conteúdo |
|---|---|
| `AssistenteSAC.dc.html` | Aplicação principal: página inicial, login, menu, todas as telas operacionais |
| `CentralRCA.dc.html` | Central de RCA (ficha RT-0001 digital), embutida no menu Gestão |
| `Cerebro.dc.html` | Cérebro (base de conhecimento), embutido no menu Conhecimento |
| `Fichas.dc.html` | Modelos de ficha em branco para impressão (A4) |
| `support.js`, `doc-page.js` | Arquivos de execução do protótipo |
| `vercel.json` | Configuração de hospedagem |
| `assets/` | Logo completo, símbolo vermelho e símbolo branco (extraídos do manual da marca) |

---

## 1. Identidade visual (manual da marca)

- **Fonte:** Montserrat (400, 500, 600, 700) em toda a aplicação.
- **Cores:**
  - Vermelho principal: `#C70602` (botões principais, destaques, faixa de seções)
  - Vermelho escuro (hover/links): `#A80502`, `#7F0401`
  - Texto: `#1F1F1F`
  - Cinza da marca: `#929090` (textos auxiliares)
  - Cinzas de apoio: `#666464`, `#545252`, `#D6D6D6`, `#E4E4E4`, `#F4F4F4`
  - Fundo: `#F4F4F4`; cartões em branco `#FFFFFF`
- **Cores de status (pílulas):**
  - Verde (ativo/aprovado/concluído): fundo `#E6F2EA`, texto `#1E6B3A`
  - Âmbar (em revisão/pendente/atenção): fundo `#FBF0D9`, texto `#7A4C00`
  - Azul (aguardando aprovação/enviado): fundo `#E6EEF8`, texto `#24508F`
  - Cinza (rascunho/inativo): fundo `#EEEEEE`, texto `#545252`
  - Vermelho (crítico/excluído/uso pela IA): fundo `#FDECEC`, texto `#A80502`
- **Logos:**
  - `assets/logo-chiacchio.png`: logo completo, usado no login e nas fichas.
  - `assets/simbolo-branco.png`: símbolo sobre o painel vermelho da página inicial.
  - `assets/simbolo-vermelho.png`: símbolo no topo do menu lateral.
- **Menu lateral:** fundo branco, item ativo com texto vermelho.

---

## 2. Página inicial (antes do login)

Tela dividida em duas colunas: painel vermelho à esquerda e área de ação à direita.

### 2.1 Painel esquerdo (vermelho)
- Símbolo branco + "GRUPO CHIACCHIO" / "Assistente SAC".
- Título: **"Gestão inteligente de manifestações do SAC"**.
- Texto: "Registre, analise, encaminhe e acompanhe cada manifestação em um único lugar, com rastreabilidade, praticidade e histórico completo."
- Quatro passos:
  - 01 SAC registra a manifestação e a IA auxilia na análise
  - 02 Analista valida e encaminha ao setor responsável
  - 03 Tratativa e aprovação quando necessárias
  - 04 Devolutiva ao cliente e histórico permanente
- Botões, em ordem de prioridade:
  - **+ REGISTRAR MANIFESTAÇÃO** (principal): botão branco grande, texto vermelho, com sombra.
  - **ENTRAR NO SISTEMA** e **SOLICITAR ACESSO** (secundários): lado a lado, contorno branco, fundo transparente. Em telas estreitas ficam um embaixo do outro, sem sobreposição.

### 2.2 Comportamento dos botões
- **+ REGISTRAR MANIFESTAÇÃO**
  - Sem login: abre a tela de Nova manifestação em **modo público** (ver seção 4.3).
  - Com login de SAC ou Administrador: abre a Nova manifestação interna completa.
- **ENTRAR NO SISTEMA**
  - Sem login: mostra o formulário de login na coluna direita.
  - Com sessão ativa: o botão passa a se chamar **ACESSAR MEU PAINEL** e leva à tela inicial do perfil. Abaixo aparece "Sessão ativa como [perfil] · leva para: [painel]".
  - Destino por perfil:
    - SAC → Dashboard (Central do Analista)
    - Setor e Representante → Minhas pendências
    - Aprovador → Aprovações (Central do Aprovador)
    - Gestor → Dashboard (Visão da Diretoria)
    - Administrador → Usuários e permissões (Painel Administrativo)
- **SOLICITAR ACESSO**: troca a coluna direita pelo formulário de solicitação (ver 2.4).

### 2.3 Login
- Campos: e-mail e senha; botão "Entrar"; link "Esqueci minha senha".
- Abaixo: atalhos de demonstração por perfil (SAC, Setor, Representante, Aprovador, Gestor, Administrador). Servem só para testar o protótipo.
- Link "Não tem conta? Solicitar acesso".

### 2.4 Solicitar acesso
- Campos: Nome completo, E-mail corporativo, Setor, Empresa (Chiacchio, Plaschio, Cesbap), Motivo/necessidade de acesso.
- Validação: todos obrigatórios; e-mail em formato válido. Mensagem de erro: "Preencha nome, e-mail válido, empresa, setor e motivo."
- Ao enviar: cria a solicitação com **STATUS = PENDENTE** e protocolo `SOL-0008`, `SOL-0009`… Tela de confirmação: "Solicitação enviada · Protocolo X · status PENDENTE. O administrador (MASTER) vai analisar e definir perfil, empresa, setor, módulos e nível de acesso. Nenhum acesso é liberado antes da aprovação."
- **Nenhum acesso é concedido automaticamente.**
- A solicitação aparece para o Administrador em Usuários e permissões (ver 12).

---

## 3. Estrutura após o login

- **Menu lateral** (232 px), agrupado:
  - Operação: Dashboard, Nova manifestação, Manifestações, Minhas pendências, Aprovações.
  - Gestão: Indicadores, RNC, Central de RCA.
  - Conhecimento: Cérebro, Banco de casos.
  - Administração: Usuários e permissões, Configurações.
- O menu mostra só os itens permitidos ao perfil. Exemplos:
  - Setor: vê pendências, RNC e Central de RCA.
  - Representante: vê só as próprias pendências.
- **Rodapé do menu:** seletor de perfil (demonstração), "Página inicial" (volta à página inicial mantendo a sessão) e "Sair" (encerra a sessão e volta à página inicial).
- **Cabeçalho:** título da tela, caminho (ex.: "Conhecimento / Cérebro"), busca global e notificações.

---

## 4. Nova manifestação

### 4.1 Etapas exibidas no topo
Registro → Análise IA → Validação SAC → Tratativa → Aprovação → Devolutiva → Finalizada. **Não há etapa de RNC.**

### 4.2 Modo interno (SAC logado)
1. **Dados do cliente:** busca por CNPJ. Ao encontrar, preenche razão social, código, contato, telefone, e-mail e cidade, e mostra o alerta "Cliente encontrado: 3 manifestações anteriores".
2. **Manifestação:** empresa do grupo, canal de entrada, tipo (Reclamação, Solicitação, Sugestão, Elogio, Dúvida, Denúncia) e descrição.
3. **Identificação:** produto, pedido, NF, lote, data de entrega, transportadora, vendedor, representante e quantidade envolvida.
   - Se o lote já aparece em outras manifestações, mostra o alerta "O lote L-2609 aparece em 2 manifestações nos últimos 90 dias."
4. **Evidências:** anexar fotos, PDF, vídeo, prints, documentos e áudio.
5. **Coluna lateral:**
   - Verificação automática dos campos.
   - Painel vermelho "Análise com IA" com os botões "Analisar manifestação com IA" e "Salvar rascunho".

### 4.3 Modo público (sem login)
- Mesma tela, porém:
  - sem menu lateral, sem etapas internas, sem verificação automática e sem análise com IA;
  - formulário em branco; campos internos ocultos (código do cliente, empresa do grupo);
  - no topo, "Voltar à página inicial".
- Painel vermelho "Enviar ao SAC", com texto explicativo e botão **Enviar manifestação**.
- Ao enviar: tela "Manifestação recebida · Protocolo MAN-XXXX" com orientação de retorno e os botões "Voltar à página inicial" e "Registrar outra".

---

## 5. Análise com IA (após "Analisar manifestação com IA")

- **Bloco 1 · Resumo:** painel vermelho com o resumo do caso, o número de sugestões validadas e o tempo de geração.
- **Sugestões por campo:** tipo, categoria, motivo, causa provável, setor responsável e prioridade. Cada sugestão tem percentual de confiança e as ações **Aceitar**, **Editar** e **Rejeitar**.
  - **A IA não sugere RNC** (regra da seção 9).
- **Casos similares:** lista de manifestações parecidas do banco de casos, com causa e tratativa adotadas.
- **Validação do SAC:** o analista confirma ou ajusta cada campo e encaminha. Toda divergência entre a sugestão da IA e a decisão do analista é registrada e alimenta os indicadores (seção 11).

---

## 6. Manifestações (lista) e detalhe

### 6.1 Lista
- Colunas: nº, cliente, tipo, setor, prioridade, SLA restante, status, data limite, reincidência e responsável. **Não há coluna de RNC.**
- Filtros por status, setor, prioridade e período.

### 6.2 Detalhe da manifestação (abas)
- Resumo, Análise IA, Tratativa, Devolutiva, Histórico, Anexos e Ficha PDF. **Não há aba de RNC.**
- Ações da tratativa: registrar tratativa, solicitar informação ao cliente e anexar evidência. **Não há botão "Abrir RNC".**
- O checklist inclui "Comunicar a Qualidade se houver indício de desvio de matéria-prima".
- A linha do tempo mostra cada etapa com data, hora e responsável.
  - Se a Calculadora de Atraso registrar um resultado, ele aparece na linha do tempo.
- **Ficha PDF:** prévia da ficha completa, com link para os modelos em branco (`Fichas.dc.html`).
  - A seção 6 da ficha é "Encaminhamento à Qualidade", com o texto "RNC: não se aplica · reclamação registrada pelo SAC não gera RNC".

---

## 7. Tratativa do setor

Para cada setor acionado:
- **Campos:**
  - O que aconteceu?
  - Qual foi a causa da ocorrência?
  - Como o caso foi resolvido para este cliente?
  - Qual ação será adotada para evitar novas ocorrências? (com responsável e prazo)
  - Responsabilidade do setor (Sim/Não/Parcial)
  - Status
- O setor anexa evidências e registra a resposta. Cada registro entra na auditoria.

---

## 8. Devolutiva e finalização

- A IA sugere um texto de devolutiva com base **apenas nos fatos registrados na tratativa**, sem assumir culpa antecipadamente.
- O SAC aceita, edita ou rejeita o texto, escolhe o canal e envia.
- A finalização exige devolutiva enviada e validação do SAC.

---

## 9. Regra de RNC (não conformidade)

### 9.1 Quando uma RNC é aberta (4 razões)
1. **Reclamação de cliente via Comercial:** o registro é criado sempre; a procedência é definida depois, na avaliação.
2. **Auditoria externa:** certificadora, órgão regulador ou auditoria feita por cliente.
3. **Auditoria interna:** auditoria periódica do SGQ, auditoria de processo ou auditoria de BPF.
4. **Desvio de especificação de matéria-prima:** detectado na inspeção de recebimento.

### 9.2 Quando NÃO se abre RNC
- **Reclamação proveniente do SAC.** Ela segue a Ficha de Encaminhamento de Manifestação e a tratativa dos setores.

### 9.3 Onde a regra foi aplicada
- Removida a RNC de todo o fluxo de manifestações: etapas, sugestão da IA, aba, botão, coluna da lista, fichas e PDF.
- Onde antes havia RNC, agora aparece "Comunicar à Qualidade".
- A tela **RNC** (menu Gestão):
  - mostra no topo o quadro "Quando uma RNC é aberta", com as 4 razões e o aviso de que reclamação do SAC não gera RNC;
  - na lista, a coluna "Manifestação" passou a ser **"Origem"**, com códigos como `REC-COM-0012`, `AUD-EXT-0004`, `AUD-INT-0018` e `INSP-MP-0211`;
  - o botão "Abrir na Central de RCA" leva à ficha digital.
- **Cérebro:** a regra oficial "Origens válidas de RNC" foi cadastrada, e a pergunta frequente "Reclamação do SAC gera RNC? → Não" foi incluída.

### 9.4 Pendente de confirmação
- **Equivalência entre as 4 razões e as opções de origem da ficha RT-0001:**
  - reclamação via Comercial → "RNC EXTERNA";
  - auditoria externa → "AUDITORIA EXTERNA";
  - auditoria interna → "AUDITORIA INTERNA";
  - desvio de matéria-prima → "INSPEÇÃO INTERNA".
- As opções "AVALIAÇÃO SAC" e "ANÁLISE CRÍTICA DA ALTA DIREÇÃO" estão na ficha oficial, mas não correspondem às 4 razões. Foram mantidas.
  - Se "Avaliação SAC" for marcada, aparece um aviso de que reclamação do SAC não gera RNC.
  - **Falta definir se essas duas opções devem ser removidas ou mantidas.**

---

## 10. Central de RCA (`CentralRCA.dc.html`)

Digitalização da ficha oficial **RT-0001 · Relatório de Não Conformidade** (Chiacchio Embalagens, Rev. 0000, 20/03/26. Criado por Gildásio Jr, Coordenador de Qualidade/Process; aprovado por Deibson Veloso, Diretor de Produção).

### 10.1 Layout
- **Coluna esquerda:** RNCs atribuídas ao usuário (nº, problema, origem, empresa, versão, status), uma nota de escopo e um link de teste de acesso negado.
- **Coluna direita:**
  - cabeçalho da RNC (nº, status, versão, origem, empresa, cliente);
  - abas: **Ficha RT-0001**, **IA e Cérebro**, **Histórico e versões**, **Ficha PDF**;
  - trilha de rastreabilidade: Origem → RNC → Análise do RCA → Evidências → Causa → Ações → Aprovação → Eficácia → Encerramento.

### 10.2 Seções da ficha (na ordem da RT-0001)
1. **Razão de abertura da RNC** (campo novo, obrigatório): as 4 razões da seção 9. É o único campo fora da ficha original, criado para aplicar a regra.
2. **Dados de entrada:**
   - Emitida por, Recebido por, Data verificação, Nº RNC, Setor, Lote, Operador, Produto, Quantidade, Cliente, Contato e Registro de origem.
   - Ficam bloqueados para o RCA: Emitida por, Nº RNC, Cliente, Contato e Registro de origem.
3. **Origem da não conformidade:** Análise crítica da alta direção, Auditoria interna, Auditoria externa, RNC externa, Inspeção interna e Avaliação SAC (mais de uma opção pode ser marcada).
4. **Tipo:** Real/Potencial · Plano de ação? Sim/Não · Procedente? Sim/Não · Devolução? Sim/Não.
5. **Descrição da não conformidade / Observação.**
6. **Ações de correção imediata:** tabela com ação, responsável e prazo; linhas podem ser adicionadas e removidas.
7. **Análise de causa:** "Por que ocorreu · Problema 1" a "Problema 5", mais a **Causa raiz**.
   - Cada porquê e a causa raiz têm "+ Vincular evidência".
   - A causa raiz **nunca é preenchida pela IA**.
8. **Ação de correção:** tabela com ação, responsável, prazo e status (Não iniciada/Em andamento/Concluída).
9. **Verificação:**
   - Texto livre, Verificação da eficácia (Conforme/Não conforme + data) e Nova NC (Sim/Não + data).
   - Só é preenchida pelo aprovador/Qualidade depois da aprovação. Para o RCA fica bloqueada.

### 10.3 Evidências da análise
- Três áreas, correspondentes às páginas 3, 4 e 5 da ficha:
  - **Anexo de evidência da NC**
  - **Evidência das ações**
  - **Evidência da eficácia** (só o aprovador anexa, após a aprovação)
- Passo a passo para anexar:
  1. Clicar em **+ ANEXAR EVIDÊNCIA** e escolher o arquivo (imagem, PDF, Word, Excel, CSV ou TXT).
  2. Aparece um quadro com o nome e o tamanho do arquivo.
  3. Preencher a **descrição da evidência** (obrigatória, mínimo de 5 caracteres). Sem ela, o botão "Confirmar anexo" fica cinza e não anexa.
  4. Escolher "Relacionada a": Problema 1–5, Causa raiz, Ação imediata, Ação de correção etc. Se escolher um porquê ou a causa raiz, o vínculo é feito automaticamente.
  5. Confirmar.
- Cada evidência mostra:
  - número (EVIDÊNCIA 01, 02…), nome do arquivo e descrição;
  - tipo, tamanho, data/hora, quem anexou, a que se relaciona e em qual versão foi enviada;
  - miniatura quando é imagem.
- Ações sobre a evidência:
  - **Visualizar:** imagem e PDF abrem dentro da tela.
  - **Baixar.**
  - **Substituir** e **Excluir:** só para o próprio arquivo, antes do envio.
  - **Solicitar remoção:** depois do envio. O arquivo continua até a decisão do aprovador.
- Toda ação com evidência (anexar, vincular, substituir, excluir, solicitar remoção) é registrada na auditoria.

### 10.4 Fluxo de status
1. **ATRIBUÍDA:** a RNC chega ao RCA.
2. **RASCUNHO:** ao salvar ou anexar pela primeira vez.
3. **SALVAR RASCUNHO:** guarda tudo (campos, evidências, vínculos). O RCA pode sair e continuar depois.
4. **ENVIAR ANÁLISE DE RCA:**
   - Valida os obrigatórios: razão de abertura, recebido por, data de verificação, operador, origem, tipo, plano de ação, procedente, devolução, descrição, pelo menos uma ação imediata completa, Problema 1, causa raiz, pelo menos uma ação de correção completa e pelo menos uma evidência da NC.
   - Campos faltantes ficam com borda vermelha e são listados.
   - Confirmação: "Após o envio, a análise será encaminhada para continuidade do processo. Alterações posteriores poderão exigir devolução para ajuste."
   - Status passa a **RCA ENVIADA**; cria a versão N; registra usuário, data/hora, versão, RNC e empresa.
5. **Revisão (perfil Aprovador/Gestor/Administrador):**
   - **Aprovar análise:** status APROVADA.
   - **Devolver para ajuste:** motivo obrigatório; status **DEVOLVIDA PARA AJUSTE**.
6. **Devolvida:** aparece o aviso com quem devolveu, quando e o motivo. O RCA corrige e reenvia; o reenvio cria a versão N+1 e a anterior fica preservada.
7. **Encerramento:** o aprovador preenche a verificação da eficácia e clica em "Registrar eficácia e encerrar RNC". Status **ENCERRADA**.

### 10.5 Limites do RCA
O RCA **não pode**:
- aprovar ou encerrar a própria RNC;
- alterar empresa, registro de origem ou cliente;
- preencher a verificação/eficácia;
- editar o Cérebro;
- transformar sugestão da IA em decisão.

### 10.6 Aba IA e Cérebro
- **SUGESTÃO DA IA** (selo vermelho): possíveis causas, perguntas de investigação e ações usadas anteriormente.
  - O botão "Copiar" copia o texto para o RCA colar e ajustar. Nada é preenchido automaticamente.
- **Cérebro (somente leitura):** RNCs similares com causa, ação e eficácia.
- **SUGERIR CONHECIMENTO:** envia uma sugestão para validação no Cérebro e registra na auditoria.

### 10.7 Aba Histórico e versões
- Versões: enviada, devolvida, reenviada e aprovada, com data/hora e autor. "Ver versão" mostra o conteúdo daquela versão (somente leitura).
- Auditoria: data/hora, usuário, empresa, RNC, ação, versão e detalhe.

### 10.8 Aba Ficha PDF
- A ficha RT-0001 preenchida, com cabeçalho oficial e todas as seções. As evidências são listadas por área e os vínculos aparecem junto de cada porquê e da causa raiz.
- "Baixar ficha em PDF" usa a impressão do navegador.

### 10.9 Escopo por empresa
- O RCA vê apenas as RNCs da própria empresa; o MASTER vê todas.
- O link "Testar acesso a RNC-0035 (Plaschio) pelo ID" mostra **403 · Acesso negado** e registra a tentativa na auditoria.

### 10.10 Exemplos cadastrados
- RNC-0031: reclamação via Comercial (REC-COM-0012), status ATRIBUÍDA.
- RNC-0030: auditoria externa (AUD-EXT-0004), devolvida para ajuste.
- RNC-0029: desvio de matéria-prima (INSP-MP-0211), RCA enviada.
- RNC-0035: Plaschio, auditoria interna (fora do escopo de Chiacchio).

---

## 11. Indicadores · Validação da IA e da ferramenta

Aba em Indicadores (Operacionais · Indicadores da IA · **Validação da IA e da ferramenta** · Comparativo IA x processo humano).

- **Metas:**
  - Assertividade geral: meta ≥ 85%.
  - Reincidência detectada: meta ≥ 60%.
  - Tempo até a sugestão: meta ≤ 10 min.
  - Erros críticos: sugestões que violaram política.
  - Testes da ferramenta: quantos passaram.
- **Teste contra o banco de casos:**
  - O botão "Executar validação" faz a IA classificar 300 casos finalizados sem ver a decisão real.
  - O resultado é comparado ao registro: assertividade por campo (tipo, categoria, motivo, causa provável, setor, prioridade e casos similares), com linha de meta em 85% e histórico de execuções por versão da base.
- **Setor sugerido x setor final:** tabela que cruza a sugestão da IA com a decisão do analista e mostra onde há mais confusão.
- **Amostra para revisão humana:** casos em que IA e analista divergiram. O revisor marca "IA correta", "Analista correto" ou "Ambos parcialmente".
- **Testes da ferramenta:** 12 verificações automáticas das regras da plataforma, como:
  - SLA conforme a matriz e cobrança após 24 h;
  - devolutiva bloqueada antes da tratativa;
  - regra de não assumir culpa;
  - finalização com etapas completas;
  - permissões por perfil e auditoria;
  - PDF completo;
  - regras em revisão fora da IA;
  - calculadora com feriados, similares e importação com revisão humana.

---

## 12. Usuários e permissões (Administrador/MASTER)

- **Solicitações de acesso** (topo da tela):
  - Cada solicitação mostra nome, e-mail, empresa, setor, protocolo, data, motivo e status.
  - Para as pendentes, o MASTER define **Perfil, Empresa, Setor, Módulos, Nível de acesso e Competências**, e então **Aprova com este perfil** ou **Rejeita**.
  - Depois de decidida, a solicitação mostra o resumo (quem, quando e configuração).
- Abaixo fica a lista de usuários existentes com perfis e permissões.

---

## 13. Cérebro (`Cerebro.dc.html`)

Fonte oficial de conhecimento usada pela IA. Só conteúdo **ativo, aprovado e marcado para a IA** entra na análise.

- **Início:**
  - Painel com o percentual de conhecimento atualizado e os conteúdos pendentes.
  - Lista do que a IA considera.
  - Cartões de atalho: Setores, Regras, Procedimentos, Políticas, Matriz, FAQ, Base de conhecimento, SLAs, Causas e Histórico.
- **Regras dos setores:**
  - Cartões por setor: SAC, Comercial, Logística, Qualidade, Produção, Expedição, Financeiro, Compras, Administrativo e Outros, mais "+ Adicionar setor".
  - Cada cartão mostra nº de regras, nº de procedimentos, SLA, gestor, data e versão; o botão **ACESSAR REGRAS** abre a página do setor.
- **Página do setor:** cabeçalho (responsável, SLA, data, versão) e as abas abaixo.
  - **Regras:**
    - Busca e filtro por status.
    - Cada regra mostra título, status, uso pela IA, REGRA/AÇÃO e metadados (setor, prioridade, aplicação, responsável, SLA, versão, última alteração).
    - Indicadores da regra: condição, pode gerar RNC, exige evidência, encaminha a outro setor e documento.
    - Ações: ativar/desativar, disponibilizar ou retirar da IA, editar, criar nova versão, ver histórico e excluir.
  - **Procedimentos:** objetivo, quando utilizar, passo a passo numerado, documentos, evidências, SLA, exceções e responsável.
  - **Políticas:** condição → regra → ação, aprovação necessária e documento de referência.
  - **FAQ:** pergunta e resposta, com setor, categoria, palavras-chave e responsável.
  - **SLA:**
    - Cinco prazos por setor, editáveis em horas: análise, tratativa, resposta interna, devolutiva e total.
    - Exceções por tipo de manifestação, prioridade, causa, empresa ou situação específica.
  - **Responsáveis:** pessoas, papéis e competências.
  - **Documentos:**
    - Tabela com nome, tipo, data, responsável, versão, status e uso pela IA (chave liga/desliga).
    - Ações: visualizar, substituir versão (a anterior fica preservada), baixar e excluir.
    - **+ ANEXAR DOCUMENTO** e **Importar regras da planilha:** prévia editável das linhas (regra, condição, ação, responsável, SLA), em que se escolhem as linhas a importar. As regras importadas entram como **Em revisão** e não são usadas pela IA até serem aprovadas.
- **Nova regra:** painel lateral com os campos abaixo.
  - Título, descrição, quando aplicar, condição, ação, documentos, observações e responsável.
  - Setor e SLA relacionado.
  - Prioridade, tipo de aplicação, pode gerar RNC (só origens válidas, nunca para reclamação do SAC), exige evidência, encaminha a outro setor e status.
  - Chave "Disponibilizar para a IA".
  - Uma regra nova entra como **Em revisão**.
- **Matriz de tratamento:**
  - Linhas Problema → Causa → Setor → Regra → Procedimento → Tratativa → Aprovação → Devolutiva.
  - Ao editar uma linha e salvar, é criada uma nova versão.
- **Causas e subcausas:** árvore Categoria → Causa → Subcausa, com inclusão de itens.
- **Aprovação do conhecimento:**
  - Quadro com as colunas Rascunho → Em revisão → Aguardando aprovação → Aprovado → Ativo.
  - Botões: Avançar, Aprovar, Ativar e Devolver.
  - Só o conteúdo Ativo é oficial.
- **Histórico de versões:** todas as versões, com alteração e motivo.
- **Auditoria:** data, hora, usuário, ação, conteúdo, versão anterior, nova versão, documento e alteração.
- **Calculadora de Atraso (Logística):**
  - Entradas: manifestação, data do pedido, data prevista, data efetiva e data de referência (usada se a entrega ainda não ocorreu).
  - Contagem em dias corridos ou dias úteis (sem fins de semana e feriados nacionais).
  - Resultado: "X DIAS DE ATRASO" (vermelho) ou "ENTREGUE NO PRAZO" (verde), com detalhamento.
  - **REGISTRAR NA MANIFESTAÇÃO** grava o resultado no histórico da manifestação.
- **Regra cadastrada:** "Origens válidas de RNC" (Qualidade, ativa, usada pela IA).

---

## 14. Banco de casos

- **Registros:** manifestações históricas, incluindo fichas antigas importadas, com busca e filtros.
- **Análise do banco** (análise estatística, independente da IA):
  - Números gerais: casos no banco, fichas antigas importadas, completude média, possíveis duplicados e padrões ativos.
  - **Padrões identificados:** tendência, lote, cliente e SLA, cada um com o botão "Ver casos" e uma ação.
    - Exemplo: o lote recorrente leva a "Comunicar à Qualidade", **não** a "Abrir RNC".
  - Gráfico de recorrência mensal.
  - Agrupamentos por similaridade: temas, palavras-chave, volume e tendência.
  - **Qualidade dos dados:** percentual de registros sem lote, sem causa, sem NF etc., com o botão "Corrigir".
- Link "Modelos de ficha (nova e antiga)" para `Fichas.dc.html`.

---

## 15. Fichas para impressão (`Fichas.dc.html`, A4)

1. **Ficha de Manifestação · modelo novo** (2 páginas): segue a estrutura da ferramenta.
   - Seções: dados do cliente; dados da manifestação; análise da IA e validação do SAC (sugestão, decisão, aceita/editada/rejeitada); encaminhamento; tratativa por setor; aprovações; devolutiva; encerramento e histórico.
   - Sem campos de RNC.
   - Traz a observação de que reclamação do SAC não gera RNC.
2. **Ficha de Encaminhamento de Manifestação · modelo oficial em uso** (1 página): reproduz campo a campo a ficha de reclamação vigente.
   - Seções: 1 Dados do Registro SAC; 2 Dados do Cliente; 3 Informações da Manifestação; 4 Produto; 5 Encaminhamento (prazo de 72 horas); 6 Resposta do Setor (4 perguntas, responsável e prazo); 7 Validação do SAC.
   - Também serve para importar fichas antigas no banco de casos.
3. **RT-0001 · Relatório de Não Conformidade** em branco (5 páginas):
   - p.1: dados de entrada, origem, tipo, descrição e ações imediatas;
   - p.2: análise de causa (5 porquês e causa raiz), ação de correção e verificação;
   - p.3 a p.5: anexo de evidência da NC, evidência das ações e evidência da eficácia.

---

## 16. O que é simulado no protótipo e precisa ser implementado no sistema definitivo

| Item | No protótipo | No sistema definitivo |
|---|---|---|
| Login e sessão | Atalhos por perfil, sem senha real | Autenticação real; redirecionamento por perfil no servidor |
| Solicitações de acesso | Ficam na tela; somem ao recarregar | Tabela no banco, status PENDENTE, e-mail ao solicitante, auditoria |
| Manifestação pública | Gera protocolo local | Endpoint público com proteção contra spam (captcha/limite) |
| Evidências da Central de RCA | Salvas no navegador, até 700 KB por arquivo; acima disso só os metadados | Armazenamento de arquivos no servidor, vinculado a empresa + RNC + usuário |
| Rascunho e versões da RCA | Salvos no navegador | Banco de dados, com versões imutáveis |
| Escopo por empresa / 403 | Simulado na tela | Autorização no servidor em toda consulta por ID (RNC e arquivo) |
| Auditoria | Lista em memória | Registro imutável: usuário, data/hora, empresa, RNC, ação, versão, valor anterior e novo |
| IA | Respostas fixas de exemplo | Integração com o modelo, usando só o conteúdo ativo e aprovado do Cérebro |
| Importação de planilha | Linhas de exemplo fixas | Leitura real do Excel/CSV, prévia, revisão e importação como "Em revisão" |
| Indicadores e validação | Números ilustrativos | Cálculo sobre os dados reais |
| Calculadora de Atraso | Feriados nacionais fixos de 2026 | Calendário de feriados configurável |
| PDF | Impressão do navegador | Geração de PDF no servidor, se exigido |

---

## 17. Pendências para decidir

1. Confirmar a equivalência entre as 4 razões de RNC e as opções de origem da ficha RT-0001 (seção 9.4).
2. Definir se "AVALIAÇÃO SAC" e "ANÁLISE CRÍTICA DA ALTA DIREÇÃO" continuam na ficha digital.
3. Definir quais empresas entram no escopo: o protótipo usa Chiacchio, Plaschio e Cesbap; um briefing anterior citava Tubahia.
4. Confirmar quem preenche a Verificação/Eficácia (hoje: Aprovador/Qualidade).
