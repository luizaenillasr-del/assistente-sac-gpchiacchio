# Implementação — Tela "Arquivo de Fichas" (Assistente SAC · Grupo Chiacchio)

Instruções para implementar a tela **Arquivo de Fichas** no sistema real. O mockup de referência está no final deste arquivo (código-fonte completo). Reproduza layout, textos, cores e comportamento **idênticos** ao mockup.

## Regras gerais

- NÃO alterar a arquitetura do sistema. Usar as rotas, autenticação, layout (menu lateral) e componentes já existentes.
- NÃO criar funcionalidades fictícias. Os dados do mockup são de exemplo; no sistema vêm do banco.
- NÃO fazer deploy. NÃO alterar outras funcionalidades.
- Antes de implementar, localizar: rota atual de "Arquivo de Fichas", modelo de manifestação/ficha, armazenamento de anexos, fluxo de importação existente (se houver).

## 1. Objetivo

Histórico completo das fichas de reclamação, unindo:
- fichas **criadas no sistema** (manifestações registradas na ferramenta);
- fichas **históricas importadas** (PDF/DOCX anteriores à ferramenta).

Organização por **empresa → ano → mês**. Empresas: CHIACCHIO EMBALAGENS, PLASCHIO, TUBAHIA.

## 2. Layout (de cima para baixo)

1. **Cabeçalho**: breadcrumb "Gestão / Arquivo de Fichas", título, texto descritivo. Botões: "↑ Importar fichas (PDF/DOCX)" (secundário) e "↻ Atualizar" (primário, vermelho #C70602).
2. **Aviso** (fundo #FFFBEF): explica que os números incluem fichas do sistema e históricas, e que a ficha importada é arquivada pela data da reclamação original, não da importação.
3. **Filtros**: busca (protocolo, cliente, CNPJ, motivo, colaborador) + Ano, Mês, Empresa, Tipo, Origem, Status + "× Limpar". Filtro ativo ganha borda vermelha.
4. **Indicadores (6 cards)**: Total geral, Este mês, Este ano, Com evidências, Com tratativa, Reincidentes. Os três últimos são clicáveis e filtram a lista (clicar de novo remove).
5. **Por empresa**: um card por empresa com total, % tratativa, % evidência, nº históricas, nº reincidentes e barra de % tratativa. Clicar filtra pela empresa.
6. **Evolução por mês**: barras dos últimos 12 meses, empilhadas (vermelho = sistema, cinza = histórica). Clicar seleciona ano/mês.
7. **Árvore "Arquivo"** (coluna esquerda): empresa ▸ ano ▸ mês com contagens. Clicar no mês filtra a lista.
8. **Tabela de fichas**: Protocolo, Data, Empresa, Cliente (com alerta "⚠ reincidente · N fichas em 12 meses"), Tipo, Motivo, Origem (badge), Evidências, Status (badge). Paginação "Carregar mais" de 25 em 25. Estado vazio com "Limpar filtros".

Responsivo: grids com `auto-fit/minmax`, tabela com rolagem horizontal, sem sobreposição em desktop/tablet/mobile.

## 3. Detalhe da ficha (painel lateral à direita)

Abre ao clicar na linha. Contém:
- protocolo, badges de origem e status, empresa e data;
- alerta de reincidência (quando aplicável) listando os protocolos;
- dados: cliente, CNPJ, tipo, motivo, colaborador responsável, empresa, data da reclamação, arquivada em (mês/ano);
- descrição da reclamação e tratativa;
- **documentos e evidências**: ficha original (importada) ou PDF gerado (sistema) + evidências anexadas, cada uma com botão "Abrir";
- histórico (linha do tempo);
- rodapé: "Ver modelo da ficha" e "Baixar PDF da ficha".

## 4. Importação de fichas históricas

Modal "Importar fichas históricas":
- aceitar **PDF e DOCX**, até 20 MB por arquivo, múltiplos arquivos;
- para cada arquivo: Empresa, **Data da reclamação** (obrigatória) e Tipo. Tentar ler empresa/data do documento; usuário confere;
- bloquear importação sem data ou com data futura;
- cada arquivo vira uma ficha com `origem = IMPORTADA`, `status = CONCLUÍDA`, protocolo `HIST-AAAA-NNN`;
- **arquivar pelo mês/ano da data da reclamação**;
- preservar o arquivo original sem alteração;
- registrar quem importou e quando (auditoria).

## 5. Regras de cálculo

- **Este mês / Este ano**: pela data da reclamação.
- **Com evidências**: fichas com ≥1 anexo de evidência.
- **Com tratativa**: fichas com tratativa concluída.
- **Reincidente**: mesmo CNPJ com **2 ou mais reclamações (tipo Reclamação) em janela de 12 meses**. O card mostra nº de clientes distintos e nº de fichas.
- Todos os indicadores respeitam os filtros ativos.
- Atenção: no sistema atual os indicadores de tratativa e evidência aparecem zerados — verificar se os campos de tratativa e evidências estão sendo lidos corretamente da base.

## 6. Modelo de dados (mínimo)

```
Ficha {
  id/protocolo, empresa, data_reclamacao (ano, mes, dia),
  cliente, cnpj, tipo (Reclamação|Sugestão|Solicitação|Elogio),
  motivo, colaborador, origem (SISTEMA|IMPORTADA),
  status (ABERTA|EM_TRATATIVA|CONCLUIDA), tratativa_concluida (bool),
  manifestacao_id (se SISTEMA), arquivo_original (se IMPORTADA),
  importado_por, importado_em
}
Anexo { id, ficha_id, nome, tipo, tamanho, descricao, usuario, data_hora }
```

## 7. Permissões e segurança

- Usuário vê somente fichas das empresas a que tem acesso. MASTER: global.
- Validar no backend por empresa e por ID (ficha e arquivo). Fora do escopo → **403**.
- Importação: somente perfis autorizados (definir com o MASTER).
- Auditar: importação, visualização de documento, download de PDF.

## 8. Endpoints sugeridos (adaptar aos existentes)

- `GET /api/fichas?empresa&ano&mes&tipo&origem&status&q&extra&page`
- `GET /api/fichas/indicadores?...mesmos filtros`
- `GET /api/fichas/arvore` (contagens empresa/ano/mês)
- `GET /api/fichas/:id` · `GET /api/fichas/:id/pdf` · `GET /api/anexos/:id`
- `POST /api/fichas/importar` (multipart: arquivos + empresa, data, tipo por arquivo)

## 9. Identidade visual

- Fonte Montserrat (400/500/600/700).
- Vermelho principal #C70602, hover/texto #A80502, escuro #7F0401.
- Texto #1F1F1F, secundário #666464, terciário #929090, bordas #E4E4E4/#D6D6D6, fundo #F4F4F4, cards brancos com raio 10–12px.
- Status: Aberta #E6EEF8/#24508F · Em tratativa #FBF0D9/#7A4C00 · Concluída #E6F2EA/#1E6B3A.
- Origem: Sistema #FDECEC/#A80502 · Histórica #EEEEEE/#3A3939.
- Menu lateral: item "Arquivo de Fichas" ativo (fundo #FDECEC, texto #A80502, negrito).

## 10. Testes obrigatórios

1. Filtros individuais e combinados; "Limpar".
2. Clique nos cards (evidências, tratativa, reincidentes), empresas, meses e árvore.
3. Abrir ficha do sistema e ficha importada; abrir anexos; baixar PDF.
4. Importar PDF e DOCX; bloquear sem data e com data futura; conferir arquivamento pelo mês da reclamação.
5. Atualizar página e logout/login: fichas importadas persistem.
6. Usuário de outra empresa acessando ID direto → 403.
7. Responsividade em desktop, notebook, tablet e mobile.

## 11. Entrega

Informar: arquivos alterados, rotas/endpoints usados, onde os arquivos ficam armazenados, testes executados e pendências.

---

## Anexo — código-fonte do mockup (referência visual e de comportamento)

Arquivo `ArquivoFichas.dc.html`. O template (entre `<x-dc>`) define o layout com estilos inline; a classe `Component` define dados de exemplo e regras (filtros, reincidência, importação). Use como referência exata; não copie os dados de exemplo.

````html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<title>Arquivo de Fichas · Assistente SAC</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
<style>
body{margin:0;background:#F4F4F4;color:#1F1F1F;font-family:Montserrat,system-ui,sans-serif;font-size:14px;-webkit-font-smoothing:antialiased}
button,input,select,textarea{font:inherit;color:inherit}button{white-space:nowrap}
a{color:#A80502;text-decoration:none}a:hover{color:#7F0401;text-decoration:underline}
*{box-sizing:border-box}
</style>
</helmet>
<div style="display:flex;min-height:100vh;width:100%;background:#F4F4F4;font-family:Montserrat,system-ui,sans-serif;color:#1F1F1F">

  <aside style="flex:0 0 232px;background:#fff;border-right:1px solid #E4E4E4;padding:16px 12px;display:flex;flex-direction:column;gap:2px;position:sticky;top:0;height:100vh;overflow-y:auto">
    <div style="display:flex;align-items:center;gap:10px;padding:4px 8px 18px"><img src="assets/simbolo-vermelho.png" alt="" style="width:30px;height:auto"><div><div style="font-weight:700;font-size:14px">Assistente SAC</div><div style="font-size:10.5px;color:#929090;letter-spacing:.08em">GRUPO CHIACCHIO</div></div></div>
    <sc-for list="{{ nav }}" as="g" hint-placeholder-count="4">
      <div style="font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#929090;font-weight:600;padding:12px 10px 4px">{{ g.l }}</div>
      <sc-for list="{{ g.items }}" as="it"><a href="{{ it.href }}" style="display:block;padding:8px 10px;border-radius:7px;font-size:13px;white-space:nowrap;color:{{ it.fg }};background:{{ it.bg }};font-weight:{{ it.fw }};text-decoration:none">{{ it.l }}</a></sc-for>
    </sc-for>
    <div style="margin-top:auto;border-top:1px solid #E4E4E4;padding:12px 10px 0;font-size:12px;color:#666464;display:flex;flex-direction:column;gap:2px"><span style="font-weight:600;color:#1F1F1F">Luiza Martins</span><span>SAC · Grupo Chiacchio</span></div>
  </aside>

  <main style="flex:1 1 0;min-width:0;padding:22px 28px 60px;display:flex;flex-direction:column;gap:16px">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap">
      <div style="min-width:0;max-width:760px"><div style="font-size:12px;color:#929090">Gestão / Arquivo de Fichas</div><div style="font-size:24px;font-weight:700;margin-top:2px">Arquivo de Fichas</div><div style="font-size:13px;color:#666464;line-height:1.5;margin-top:4px">Histórico completo das fichas de reclamação: as anteriores à ferramenta, as criadas no sistema e as concluídas. Organizado por empresa, ano e mês.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button onClick="{{ openImport }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:8px;padding:9px 14px;cursor:pointer;font-size:13px;font-weight:600">↑ Importar fichas (PDF/DOCX)</button>
        <button onClick="{{ refresh }}" style="border:0;background:#C70602;color:#fff;border-radius:8px;padding:9px 14px;cursor:pointer;font-size:13px;font-weight:600">{{ refreshL }}</button>
      </div>
    </div>

    <div style="background:#FFFBEF;border:1px solid #F1E2B5;border-radius:10px;padding:12px 16px;font-size:13px;line-height:1.55;color:#5E3B00">Os números abaixo incluem as fichas <strong>criadas no sistema</strong> e as <strong>fichas históricas importadas</strong> (PDF ou DOCX de antes da ferramenta). Cada ficha importada fica arquivada pela empresa, mês e ano da reclamação original, não pela data da importação.</div>

    <div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:12px 14px;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
      <label style="flex:1 1 260px;display:flex;flex-direction:column;gap:4px;font-size:11px;color:#666464;font-weight:600">Buscar<input value="{{ q }}" onChange="{{ onQ }}" placeholder="Protocolo, cliente, CNPJ, motivo, colaborador…" style="height:36px;border:1px solid #D6D6D6;border-radius:7px;padding:0 12px;background:#fff;font-size:13px;font-weight:400;color:#1F1F1F"></label>
      <sc-for list="{{ selects }}" as="s" hint-placeholder-count="6"><label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:#666464;font-weight:600">{{ s.l }}<select value="{{ s.v }}" onChange="{{ s.on }}" style="height:36px;border:1px solid {{ s.bd }};border-radius:7px;padding:0 8px;background:#fff;font-size:12.5px;color:#1F1F1F;font-weight:500;min-width:120px"><sc-for list="{{ s.o }}" as="o"><option value="{{ o.v }}">{{ o.l }}</option></sc-for></select></label></sc-for>
      <button onClick="{{ clear }}" style="height:36px;border:1px solid #D6D6D6;background:#fff;border-radius:7px;padding:0 12px;cursor:pointer;font-size:12.5px;color:#A80502;font-weight:600">× Limpar</button>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px">
      <sc-for list="{{ kpis }}" as="k" hint-placeholder-count="6"><button onClick="{{ k.go }}" style="text-align:left;background:{{ k.bg }};border:1px solid {{ k.bd }};border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:2px;cursor:pointer;white-space:normal"><span style="font-size:11px;font-weight:700;letter-spacing:.05em;color:{{ k.lc }}">{{ k.l }}</span><span style="font-size:26px;font-weight:700;color:{{ k.c }};font-variant-numeric:tabular-nums">{{ k.v }}</span><span style="font-size:11.5px;color:#929090">{{ k.d }}</span></button></sc-for>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:14px">
      <div style="background:#fff;border:1px solid #E4E4E4;border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:10px">
        <span style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#545252">POR EMPRESA</span>
        <sc-for list="{{ emps }}" as="e" hint-placeholder-count="3">
          <button onClick="{{ e.go }}" style="display:grid;grid-template-columns:56px minmax(0,1fr) 14px;gap:12px;align-items:center;text-align:left;border:1.5px solid {{ e.bd }};background:{{ e.bg }};border-radius:10px;padding:10px 14px;cursor:pointer;white-space:normal">
            <span style="font-size:26px;font-weight:700;color:#C70602;font-variant-numeric:tabular-nums">{{ e.n }}</span>
            <span style="min-width:0;display:flex;flex-direction:column;gap:5px"><span style="font-weight:700;font-size:13.5px;letter-spacing:.03em">{{ e.l }}</span>
              <span style="display:flex;gap:4px 12px;flex-wrap:wrap;font-size:11.5px;color:#666464"><span style="white-space:nowrap">Tratativa {{ e.trat }}</span><span style="white-space:nowrap">Evidência {{ e.evid }}</span><span style="white-space:nowrap">{{ e.hist }} históricas</span><sc-if value="{{ e.hasRe }}"><span style="white-space:nowrap;color:#A80502;font-weight:600">⚠ {{ e.re }} reincidentes</span></sc-if></span>
              <span style="display:block;flex:none;height:5px;border-radius:3px;background:#F0F0F0;overflow:hidden;position:relative"><span style="display:block;position:absolute;left:0;top:0;bottom:0;width:{{ e.wT }};background:#1E6B3A"></span></span></span>
            <span style="color:#929090">›</span>
          </button>
        </sc-for>
      </div>
      <div style="background:#fff;border:1px solid #E4E4E4;border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline"><span style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#545252">EVOLUÇÃO POR MÊS</span><span style="display:flex;gap:10px;font-size:11px;color:#666464"><span style="display:flex;gap:4px;align-items:center"><span style="width:10px;height:10px;border-radius:2px;background:#C70602"></span>Sistema</span><span style="display:flex;gap:4px;align-items:center"><span style="width:10px;height:10px;border-radius:2px;background:#929090"></span>Histórica</span></span></div>
        <div style="display:flex;align-items:flex-end;gap:4px;height:170px">
          <sc-for list="{{ months }}" as="m" hint-placeholder-count="12"><button onClick="{{ m.go }}" title="{{ m.t }}" style="flex:1;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px;border:0;background:none;padding:0;cursor:pointer"><span style="font-size:10.5px;font-weight:700;color:#3A3939">{{ m.n }}</span><span style="width:100%;max-width:28px;display:flex;flex-direction:column;border-radius:3px 3px 0 0;overflow:hidden;outline:{{ m.ol }};outline-offset:2px"><span style="height:{{ m.hS }};background:#C70602"></span><span style="height:{{ m.hH }};background:#929090"></span></span></button></sc-for>
        </div>
        <div style="display:flex;gap:4px"><sc-for list="{{ months }}" as="m"><span style="flex:1;min-width:0;text-align:center;font-size:10px;color:#666464;white-space:nowrap;overflow:hidden">{{ m.l }}</span></sc-for></div>
      </div>
    </div>

    <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start">
      <div style="flex:1 1 220px;max-width:100%;background:#fff;border:1px solid #E4E4E4;border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:2px">
        <span style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#545252;padding:4px 8px 8px">ARQUIVO</span>
        <sc-for list="{{ tree }}" as="e" hint-placeholder-count="3">
          <button onClick="{{ e.go }}" style="display:flex;justify-content:space-between;border:0;background:{{ e.bg }};border-radius:6px;padding:8px;cursor:pointer;font-weight:700;font-size:13px;text-align:left"><span>{{ e.sign }} {{ e.l }}</span><span style="font-size:12px;color:#929090;font-weight:500">{{ e.n }}</span></button>
          <sc-if value="{{ e.open }}"><sc-for list="{{ e.years }}" as="y">
            <button onClick="{{ y.go }}" style="display:flex;justify-content:space-between;border:0;background:{{ y.bg }};border-radius:6px;padding:6px 8px 6px 22px;cursor:pointer;font-size:12.5px;font-weight:600;text-align:left"><span>{{ y.sign }} {{ y.l }}</span><span style="font-size:12px;color:#929090;font-weight:500">{{ y.n }}</span></button>
            <sc-if value="{{ y.open }}"><sc-for list="{{ y.months }}" as="m"><button onClick="{{ m.go }}" style="display:flex;justify-content:space-between;border:0;border-left:2px solid {{ m.bl }};background:{{ m.bg }};padding:5px 8px 5px 12px;margin-left:34px;cursor:pointer;font-size:12.5px;color:{{ m.fg }};font-weight:{{ m.fw }};text-align:left"><span>{{ m.l }}</span><span style="font-variant-numeric:tabular-nums">{{ m.n }}</span></button></sc-for></sc-if>
          </sc-for></sc-if>
        </sc-for>
      </div>

      <div style="flex:999 1 600px;min-width:0;background:#fff;border:1px solid #E4E4E4;border-radius:12px;overflow:hidden">
        <div style="padding:12px 16px;border-bottom:1px solid #EFEFEF;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><span style="font-weight:700;font-size:14px">{{ listTitle }}</span><span style="font-size:12px;color:#666464">{{ countTxt }}</span></div>
        <div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;min-width:860px;font-size:12.5px">
          <thead><tr style="background:#FAFAFA"><sc-for list="{{ cols }}" as="c"><th style="text-align:left;font-weight:600;font-size:11.5px;color:#666464;padding:9px 12px;border-bottom:1px solid #E4E4E4;white-space:nowrap">{{ c }}</th></sc-for></tr></thead>
          <tbody><sc-for list="{{ rows }}" as="r" hint-placeholder-count="10"><tr onClick="{{ r.go }}" style="border-bottom:1px solid #EFEFEF;cursor:pointer" style-hover="background:#FAFAFA">
            <td style="padding:9px 12px;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums">{{ r.id }}</td>
            <td style="padding:9px 12px;white-space:nowrap;color:#545252">{{ r.data }}</td>
            <td style="padding:9px 12px">{{ r.emp }}</td>
            <td style="padding:9px 12px;max-width:220px"><div style="display:flex;flex-direction:column;gap:2px"><span>{{ r.cli }}</span><sc-if value="{{ r.re }}"><span style="font-size:10.5px;font-weight:700;color:#A80502">⚠ reincidente · {{ r.reN }} fichas em 12 meses</span></sc-if></div></td>
            <td style="padding:9px 12px">{{ r.tipo }}</td>
            <td style="padding:9px 12px;max-width:200px">{{ r.motivo }}</td>
            <td style="padding:9px 12px"><span style="padding:2px 8px;border-radius:99px;font-size:10.5px;font-weight:700;white-space:nowrap;background:{{ r.or.bg }};color:{{ r.or.fg }}">{{ r.or.t }}</span></td>
            <td style="padding:9px 12px;white-space:nowrap;color:#545252">{{ r.evid }}</td>
            <td style="padding:9px 12px"><span style="padding:2px 8px;border-radius:99px;font-size:10.5px;font-weight:700;white-space:nowrap;background:{{ r.st.bg }};color:{{ r.st.fg }}">{{ r.st.t }}</span></td>
          </tr></sc-for></tbody>
        </table></div>
        <sc-if value="{{ empty }}"><div style="padding:34px 16px;text-align:center;display:flex;flex-direction:column;gap:8px;align-items:center"><span style="font-weight:600">Nenhuma ficha neste recorte</span><button onClick="{{ clear }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:7px;padding:7px 12px;cursor:pointer;font-size:12.5px">Limpar filtros</button></div></sc-if>
        <sc-if value="{{ more }}"><div style="padding:10px;text-align:center"><button onClick="{{ loadMore }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:7px;padding:7px 14px;cursor:pointer;font-size:12.5px">Carregar mais</button></div></sc-if>
      </div>
    </div>
  </main>

  <sc-if value="{{ dr.show }}">
  <div onClick="{{ closeDr }}" style="position:fixed;inset:0;background:rgba(20,20,20,.45);z-index:60;display:flex;justify-content:flex-end">
    <div onClick="{{ stop }}" data-screen-label="Detalhe da ficha" style="width:min(720px,100%);height:100%;background:#F4F4F4;display:flex;flex-direction:column">
      <div style="background:#fff;padding:14px 20px;border-bottom:1px solid #E4E4E4;display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div style="display:flex;flex-direction:column;gap:4px"><span style="font-size:11px;color:#929090;font-weight:600;letter-spacing:.06em">FICHA DE RECLAMAÇÃO</span><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-weight:700;font-size:18px">{{ dr.id }}</span><span style="padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700;background:{{ dr.or.bg }};color:{{ dr.or.fg }}">{{ dr.or.t }}</span><span style="padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700;background:{{ dr.st.bg }};color:{{ dr.st.fg }}">{{ dr.st.t }}</span></div><span style="font-size:12.5px;color:#545252">{{ dr.emp }} · {{ dr.data }}</span></div>
        <button onClick="{{ closeDr }}" style="border:0;background:none;cursor:pointer;font-size:24px;color:#666464;padding:0 4px;line-height:1">×</button>
      </div>
      <div style="flex:1;overflow:auto;padding:16px 20px;display:flex;flex-direction:column;gap:14px">
        <sc-if value="{{ dr.re }}"><div style="background:#FDECEC;border:1.5px solid #C70602;border-radius:10px;padding:12px 14px;font-size:13px;color:#7F0401"><strong>Cliente reincidente:</strong> {{ dr.reN }} fichas nos últimos 12 meses ({{ dr.reIds }}).</div></sc-if>
        <div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:14px 16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px 16px"><sc-for list="{{ dr.f }}" as="f"><div><div style="font-size:10.5px;color:#929090;font-weight:600">{{ f.l }}</div><div style="font-size:13px;overflow-wrap:anywhere">{{ f.v }}</div></div></sc-for></div>
        <div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:6px"><span style="font-size:10.5px;color:#929090;font-weight:600">DESCRIÇÃO DA RECLAMAÇÃO</span><span style="font-size:13.5px;line-height:1.55">{{ dr.desc }}</span><span style="font-size:10.5px;color:#929090;font-weight:600;margin-top:6px">TRATATIVA</span><span style="font-size:13.5px;line-height:1.55">{{ dr.trat }}</span></div>
        <div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:10px">
          <span style="font-weight:700;font-size:14px">Documentos e evidências</span>
          <sc-for list="{{ dr.docs }}" as="d"><div style="display:flex;gap:12px;align-items:center;border:1px solid #EFEFEF;border-radius:8px;padding:10px 12px"><span style="width:38px;height:44px;border-radius:5px;background:{{ d.c }};color:#fff;display:grid;place-items:center;font-size:10px;font-weight:700;flex:none">{{ d.ext }}</span><div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font-size:13px;font-weight:600;overflow-wrap:anywhere">{{ d.n }}</span><span style="font-size:11.5px;color:#929090">{{ d.m }}</span></div><button onClick="{{ d.go }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px">Abrir</button></div></sc-for>
          <sc-if value="{{ dr.noDocs }}"><span style="font-size:12.5px;color:#929090">Nenhuma evidência anexada.</span></sc-if>
        </div>
        <div style="background:#fff;border:1px solid #E4E4E4;border-radius:10px;padding:14px 16px">
          <div style="font-weight:700;font-size:14px;margin-bottom:10px">Histórico</div>
          <sc-for list="{{ dr.hist }}" as="h"><div style="display:grid;grid-template-columns:14px minmax(0,1fr);gap:12px"><div style="display:flex;flex-direction:column;align-items:center"><span style="width:10px;height:10px;border-radius:50%;background:#929090;margin-top:4px;flex:none"></span><span style="flex:1;width:2px;background:#EFEFEF"></span></div><div style="padding-bottom:12px"><div style="font-size:11.5px;color:#929090">{{ h.at }}</div><div style="font-size:13px">{{ h.t }}</div></div></div></sc-for>
        </div>
      </div>
      <div style="background:#fff;border-top:1px solid #E4E4E4;padding:12px 20px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><a href="Fichas.dc.html" style="border:1px solid #D6D6D6;border-radius:8px;padding:9px 14px;font-size:13px;color:#1F1F1F">Ver modelo da ficha</a><button onClick="{{ dr.pdf }}" style="border:0;background:#1F1F1F;color:#fff;border-radius:8px;padding:9px 16px;cursor:pointer;font-size:13px;font-weight:600">Baixar PDF da ficha</button></div>
    </div>
  </div>
  </sc-if>

  <sc-if value="{{ im.show }}">
  <div style="position:fixed;inset:0;background:rgba(20,20,20,.5);z-index:70;display:grid;place-items:center;padding:20px">
    <div data-screen-label="Importar fichas" style="width:min(620px,100%);max-height:100%;overflow:auto;background:#fff;border-radius:12px">
      <div style="padding:16px 20px;border-bottom:1px solid #E4E4E4;display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><div style="font-weight:700;font-size:17px">Importar fichas históricas</div><div style="font-size:12.5px;color:#666464">Fichas em PDF ou DOCX de antes da ferramenta. Cada arquivo vira uma ficha arquivada.</div></div><button onClick="{{ closeImport }}" style="border:0;background:none;cursor:pointer;font-size:24px;color:#666464;padding:0 4px;line-height:1">×</button></div>
      <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
        <button onClick="{{ im.pick }}" style="border:2px dashed #CFCFCF;background:#FAFAFA;border-radius:10px;padding:26px 16px;cursor:pointer;display:flex;flex-direction:column;gap:6px;align-items:center;white-space:normal"><span style="font-size:22px">↑</span><span style="font-weight:600;font-size:13.5px">Arraste os arquivos ou clique para selecionar</span><span style="font-size:12px;color:#929090">PDF ou DOCX · até 20 MB por arquivo</span></button>
        <sc-for list="{{ im.files }}" as="f"><div style="border:1px solid #E4E4E4;border-radius:9px;padding:10px 12px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 10px;align-items:center">
          <div style="min-width:0"><div style="font-size:13px;font-weight:600;overflow-wrap:anywhere">{{ f.n }}</div><div style="font-size:11.5px;color:{{ f.mc }}">{{ f.m }}</div></div>
          <button onClick="{{ f.del }}" style="border:0;background:none;color:#A80502;cursor:pointer;font-size:16px">×</button>
          <div style="grid-column:1 / -1;display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px">
            <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#666464;font-weight:600">Empresa<select value="{{ f.emp }}" onChange="{{ f.onEmp }}" style="height:32px;border:1px solid #D6D6D6;border-radius:6px;padding:0 6px;background:#fff;font-size:12.5px;color:#1F1F1F"><sc-for list="{{ empO }}" as="o"><option value="{{ o }}">{{ o }}</option></sc-for></select></label>
            <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#666464;font-weight:600">Data da reclamação<input type="date" value="{{ f.data }}" onChange="{{ f.onData }}" style="height:32px;border:1px solid {{ f.dbc }};border-radius:6px;padding:0 6px;background:#fff;font-size:12.5px"></label>
            <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#666464;font-weight:600">Tipo<select value="{{ f.tipo }}" onChange="{{ f.onTipo }}" style="height:32px;border:1px solid #D6D6D6;border-radius:6px;padding:0 6px;background:#fff;font-size:12.5px;color:#1F1F1F"><sc-for list="{{ tipoO }}" as="o"><option value="{{ o }}">{{ o }}</option></sc-for></select></label>
          </div>
        </div></sc-for>
        <span style="font-size:12px;color:#666464;line-height:1.5">Empresa e data são lidas do documento quando possível e devem ser conferidas. A ficha fica arquivada pela data da reclamação original. O arquivo original é preservado sem alteração.</span>
      </div>
      <div style="padding:12px 20px 18px;display:flex;justify-content:flex-end;gap:8px"><button onClick="{{ closeImport }}" style="border:1px solid #D6D6D6;background:#fff;border-radius:8px;padding:9px 16px;cursor:pointer;font-size:13px">Cancelar</button><button onClick="{{ im.ok }}" style="border:0;background:{{ im.okBg }};color:#fff;border-radius:8px;padding:9px 18px;cursor:pointer;font-size:13px;font-weight:700">{{ im.okL }}</button></div>
    </div>
  </div>
  </sc-if>

  <sc-if value="{{ toast }}"><div style="position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#1F1F1F;color:#fff;padding:11px 16px;border-radius:8px;font-size:13px;z-index:90;max-width:92vw">{{ toast }}</div></sc-if>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script>
class Component extends DCLogic {
  state = { db: null, q: '', f: null, sel: null, limit: 25, tree: { emp: 'Chiacchio', ano: 2026 }, imp: false, files: [], toast: '', busy: false };
  F0() { return { ano: 'Todos', mes: 'Todos', emp: 'Todas', tipo: 'Todos', origem: 'Todas', status: 'Todos', extra: '' }; }
  componentDidMount() { let db = null; try { db = JSON.parse(localStorage.getItem('gc-arquivo-fichas-v2') || 'null'); } catch (e) { } this.setState({ db: db || this.seed(), f: this.F0() }); }
  save(db) { try { localStorage.setItem('gc-arquivo-fichas-v2', JSON.stringify(db)); } catch (e) { } }
  flash(t) { this.setState({ toast: t }); clearTimeout(this._t); this._t = setTimeout(() => this.setState({ toast: '' }), 2800); }
  seed() {
    let sd = 7; const r = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; }, pick = a => a[Math.floor(r() * a.length)];
    const CLI = [['Empresa Exemplo Ltda.', '10.100.200/0001-10'], ['Comércio Modelo S.A.', '17.137.253/0001-13'], ['Indústria Teste Ltda.', '24.174.306/0001-16'], ['Mercado Exemplo ME', '31.211.359/0001-19'], ['Distribuidora Alfa Ltda.', '38.248.412/0001-22'], ['Padaria Bom Grão ME', '45.285.465/0001-25'], ['Frigorífico Serra Ltda.', '52.322.518/0001-28'], ['Supermercado Central Ltda.', '59.359.571/0001-31'], ['Laticínios Vale Verde Ltda.', '66.396.624/0001-34'], ['Hortifruti Sol ME', '73.433.677/0001-37'], ['Cooperativa Agro Norte', '80.470.730/0001-40'], ['Confeitaria Doce Lar ME', '87.507.783/0001-43'], ['Atacadão Bahia Ltda.', '94.544.836/0001-46'], ['Granja Boa Vista Ltda.', '11.581.889/0001-49']];
    const MOT = { Reclamação: ['Atraso na entrega', 'Embalagem com defeito de cola', 'Impressão borrada', 'Quantidade divergente da nota', 'Gramatura fora do especificado', 'Avaria no transporte', 'Cobrança indevida'], Sugestão: ['Novo tamanho de bandeja', 'Melhoria no agendamento de entrega'], Solicitação: ['Segunda via de laudo', 'Troca de produto'], Elogio: ['Atendimento do representante'] };
    const COL = ['Luiza Martins', 'Rafael Souza', 'Camila Torres', 'Diego Alves', 'Paula Ramos'];
    const out = []; const seq = { s: 101, h: 1 };
    const months = []; for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) if (!(y === 2026 && m > 10)) months.push([y, m]);
    const EMPW = [['Chiacchio', 1.1], ['Plaschio', 1], ['Tubahia', 0.6]];
    months.forEach(([y, m]) => EMPW.forEach(([e, w]) => {
      const sys = y === 2026 && m >= 4; const n = Math.round((sys ? 2.2 : 1.3) * w + r() * 2);
      for (let i = 0; i < n; i++) {
        const tipo = r() < 0.78 ? 'Reclamação' : pick(['Sugestão', 'Solicitação', 'Elogio']);
        const c = r() < 0.12 ? CLI[Math.floor(r() * 3)] : [pick(CLI)[0].replace(/ (Ltda\.|S\.A\.|ME)$/, '') + ' ' + pick(['Norte', 'Sul', 'Centro', 'Matriz', 'Filial 2', 'Leste', 'Oeste', 'Bahia', 'Vitória', 'Recôncavo']) + ' Ltda.', String(10 + Math.floor(r() * 89)) + '.' + String(100 + Math.floor(r() * 899)) + '.' + String(100 + Math.floor(r() * 899)) + '/0001-' + String(10 + Math.floor(r() * 89))];
        const dia = 1 + Math.floor(r() * (y === 2026 && m === 10 ? 5 : 27)), recent = y === 2026 && m >= 9;
        const status = sys ? (recent ? (r() < 0.5 ? 'Em tratativa' : 'Aberta') : (r() < 0.85 ? 'Concluída' : 'Em tratativa')) : 'Concluída';
        const id = sys ? 'MAN-' + String(seq.s++).padStart(4, '0') : 'HIST-' + y + '-' + String(seq.h++).padStart(3, '0');
        const evid = sys ? (r() < 0.75 ? 1 + Math.floor(r() * 3) : 0) : (r() < 0.3 ? 1 : 0);
        out.push({ id, emp: e, ano: y, mes: m, dia, cli: c[0], cnpj: c[1], tipo, motivo: pick(MOT[tipo]), col: pick(COL), origem: sys ? 'Sistema' : 'Importada', status, evid, trat: status === 'Concluída', arq: sys ? '' : 'Ficha_reclamacao_' + e.toLowerCase() + '_' + String(dia).padStart(2, '0') + '-' + String(m).padStart(2, '0') + '-' + y + (r() < 0.6 ? '.pdf' : '.docx'), imp: sys ? '' : '12/03/2026 ' + (9 + Math.floor(r() * 8)) + ':' + String(Math.floor(r() * 60)).padStart(2, '0') });
      }
    }));
    return { fichas: out, seq };
  }
  renderVals() {
    const S = this.state;
    const NAV = [['Operação', ['Dashboard', 'Manifestações', 'Nova manifestação', 'Minhas pendências']], ['Gestão', ['Indicadores', 'RNC', 'Aprovações', 'Representantes', 'Setores', 'Arquivo de Fichas', 'Matriz de Tratamento', 'Causas e Subcausas', 'Matriz de Conhecimento']], ['Conhecimento', ['Cérebro', 'Banco de casos']], ['Administração', ['Usuários e acessos']]];
    const nav = NAV.map(([l, it]) => ({ l, items: it.map(x => { const on = x === 'Arquivo de Fichas'; return { l: x, href: on ? '#' : x === 'Cérebro' ? 'Cerebro.dc.html' : 'AssistenteSAC.dc.html', bg: on ? '#FDECEC' : 'transparent', fg: on ? '#A80502' : '#545252', fw: on ? '700' : '500' }; }) }));
    if (!S.db || !S.f) return { nav, selects: [], kpis: [], emps: [], months: [], tree: [], rows: [], cols: [], dr: {}, im: {} };
    const F = S.f, all = S.db.fichas, MN = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'], MS = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const EMP = ['Chiacchio', 'Plaschio', 'Tubahia'], EMPL = { Chiacchio: 'CHIACCHIO EMBALAGENS', Plaschio: 'PLASCHIO', Tubahia: 'TUBAHIA' };
    const idx = f => f.ano * 12 + f.mes;
    const reMap = {}; all.forEach(f => { reMap[f.cnpj] = reMap[f.cnpj] || []; reMap[f.cnpj].push(f); });
    const reOf = f => (reMap[f.cnpj] || []).filter(x => x.tipo === 'Reclamação' && Math.abs(idx(x) - idx(f)) <= 11);
    const isRe = f => f.tipo === 'Reclamação' && reOf(f).length >= 2;
    const setF = (k, v) => this.setState({ f: Object.assign({}, S.f, { [k]: v }), limit: 25 });
    const q = S.q.trim().toLowerCase();
    const base = all.filter(f => (F.ano === 'Todos' || String(f.ano) === F.ano) && (F.mes === 'Todos' || String(f.mes) === F.mes) && (F.emp === 'Todas' || f.emp === F.emp) && (F.tipo === 'Todos' || f.tipo === F.tipo) && (F.origem === 'Todas' || f.origem === F.origem) && (F.status === 'Todos' || f.status === F.status) && (!q || [f.id, f.cli, f.cnpj, f.emp, f.motivo, f.col].join(' ').toLowerCase().includes(q)));
    const list = base.filter(f => F.extra === 'evid' ? f.evid > 0 : F.extra === 'trat' ? f.trat : F.extra === 're' ? isRe(f) : true).sort((a, b) => idx(b) - idx(a) || b.dia - a.dia);
    const opt = a => a.map(x => Array.isArray(x) ? { v: x[0], l: x[1] } : { v: x, l: x });
    const SEL = [['ano', 'Ano', opt(['Todos', '2026', '2025'])], ['mes', 'Mês', opt([['Todos', 'Todos os meses']].concat(MN.slice(1).map((m, i) => [String(i + 1), m])))], ['emp', 'Empresa', opt(['Todas'].concat(EMP))], ['tipo', 'Tipo', opt(['Todos', 'Reclamação', 'Sugestão', 'Solicitação', 'Elogio'])], ['origem', 'Origem', opt([['Todas', 'Todas'], ['Sistema', 'Criada no sistema'], ['Importada', 'Histórica importada']])], ['status', 'Status', opt(['Todos', 'Aberta', 'Em tratativa', 'Concluída'])]];
    const F0 = this.F0();
    const selects = SEL.map(([k, l, o]) => ({ l, o, v: F[k], on: e => setF(k, e.target.value), bd: F[k] !== F0[k] ? '#C70602' : '#D6D6D6' }));
    const pc = (a, n) => n ? Math.round(a / n * 100) + '%' : '—';
    const thisM = base.filter(f => f.ano === 2026 && f.mes === 10).length, thisY = base.filter(f => f.ano === 2026).length;
    const ev = base.filter(f => f.evid > 0).length, tr = base.filter(f => f.trat).length, re = new Set(base.filter(isRe).map(f => f.cnpj)).size, reF = base.filter(isRe).length;
    const K = (l, v, d, c, extra, red) => { const on = F.extra === extra && extra; return { l, v: String(v), d, c, lc: red ? '#A80502' : '#545252', bg: on ? '#1F1F1F0D' : red ? '#FFF8F8' : '#fff', bd: on ? '#1F1F1F' : red ? '#F3CFCF' : '#E4E4E4', go: () => setF('extra', F.extra === extra ? '' : extra) }; };
    const kpis = [K('TOTAL GERAL', base.length, base.filter(f => f.origem === 'Importada').length + ' históricas · ' + base.filter(f => f.origem === 'Sistema').length + ' no sistema', '#1F1F1F', ''), K('ESTE MÊS', thisM, 'outubro/2026', '#24508F', ''), K('ESTE ANO', thisY, '2026', '#5B3FA0', ''), K('COM EVIDÊNCIAS', ev, pc(ev, base.length) + ' documentadas', '#0E7C86', 'evid'), K('COM TRATATIVA', tr, pc(tr, base.length) + ' concluídas', '#1E6B3A', 'trat'), K('REINCIDENTES', re, reF + ' fichas · clientes com 2+ reclamações em 12 meses', '#C70602', 're', true)];
    const emps = EMP.map(e => { const l = base.filter(f => f.emp === e), on = F.emp === e; const t = l.filter(f => f.trat).length; return { l: EMPL[e], n: String(l.length), trat: pc(t, l.length), evid: pc(l.filter(f => f.evid > 0).length, l.length), hist: String(l.filter(f => f.origem === 'Importada').length), re: String(new Set(l.filter(isRe).map(f => f.cnpj)).size), hasRe: l.some(isRe), wT: l.length ? (t / l.length * 100) + '%' : '0%', bd: on ? '#C70602' : '#E4E4E4', bg: on ? '#FFF8F8' : '#FAFAFA', go: () => setF('emp', on ? 'Todas' : e) }; });
    const mk = []; for (let i = 11; i >= 0; i--) { const t = 2026 * 12 + 10 - i; mk.push([Math.floor((t - 1) / 12), ((t - 1) % 12) + 1]); }
    const bm = base.filter(f => F.ano === 'Todos' && F.mes === 'Todos' ? true : true);
    const mc = mk.map(([y, m]) => { const l = bm.filter(f => f.ano === y && f.mes === m); return { y, m, s: l.filter(f => f.origem === 'Sistema').length, h: l.filter(f => f.origem === 'Importada').length }; });
    const mmax = Math.max(1, ...mc.map(x => x.s + x.h));
    const months = mc.map(x => { const on = F.ano === String(x.y) && F.mes === String(x.m); return { l: MS[x.m] + '/' + String(x.y).slice(2), n: String(x.s + x.h), t: MN[x.m] + '/' + x.y + ': ' + x.s + ' no sistema, ' + x.h + ' históricas', hS: (x.s / mmax * 130) + 'px', hH: (x.h / mmax * 130) + 'px', ol: on ? '2px solid #1F1F1F' : 'none', go: () => this.setState({ f: Object.assign({}, S.f, on ? { ano: 'Todos', mes: 'Todos' } : { ano: String(x.y), mes: String(x.m) }), limit: 25 }) }; });
    const T = S.tree;
    const tree = EMP.map(e => { const el = all.filter(f => f.emp === e), op = T.emp === e; return { l: EMPL[e], n: String(el.length), sign: op ? '▾' : '▸', open: op, bg: op ? '#F4F4F4' : 'transparent', go: () => this.setState({ tree: { emp: op ? null : e, ano: 2026 } }),
      years: [2026, 2025].map(y => { const yl = el.filter(f => f.ano === y), yo = op && T.ano === y; return { l: String(y), n: String(yl.length), sign: yo ? '▾' : '▸', open: yo, bg: 'transparent', go: () => this.setState({ tree: { emp: e, ano: yo ? null : y } }),
        months: Array.from({ length: 12 }, (_, i) => 12 - i).filter(m => yl.some(f => f.mes === m)).map(m => { const on = F.emp === e && F.ano === String(y) && F.mes === String(m); return { l: MN[m], n: String(yl.filter(f => f.mes === m).length), bg: on ? '#FDECEC' : 'transparent', fg: on ? '#A80502' : '#3A3939', fw: on ? '700' : '500', bl: on ? '#C70602' : '#E4E4E4', go: () => this.setState({ f: Object.assign({}, S.f, { emp: e, ano: String(y), mes: String(m) }), limit: 25 }) }; }) }; }) }; });
    const OR = { Sistema: { t: 'Criada no sistema', bg: '#FDECEC', fg: '#A80502' }, Importada: { t: 'Histórica importada', bg: '#EEEEEE', fg: '#3A3939' } };
    const ST = { 'Aberta': ['#E6EEF8', '#24508F'], 'Em tratativa': ['#FBF0D9', '#7A4C00'], 'Concluída': ['#E6F2EA', '#1E6B3A'] };
    const stP = s => ({ t: s, bg: ST[s][0], fg: ST[s][1] });
    const dt = f => String(f.dia).padStart(2, '0') + '/' + String(f.mes).padStart(2, '0') + '/' + f.ano;
    const rows = list.slice(0, S.limit).map(f => ({ id: f.id, data: dt(f), emp: f.emp, cli: f.cli, re: isRe(f), reN: String(reOf(f).length), tipo: f.tipo, motivo: f.motivo, or: OR[f.origem], evid: f.evid ? f.evid + (f.evid > 1 ? ' arquivos' : ' arquivo') : '—', st: stP(f.status), go: () => this.setState({ sel: f.id }) }));
    const parts = []; if (F.emp !== 'Todas') parts.push(EMPL[F.emp]); if (F.mes !== 'Todos') parts.push(MN[+F.mes]); if (F.ano !== 'Todos') parts.push(F.ano);
    const listTitle = 'Fichas' + (parts.length ? ' · ' + parts.join(' · ') : '') + (F.extra === 're' ? ' · reincidentes' : F.extra === 'evid' ? ' · com evidências' : F.extra === 'trat' ? ' · com tratativa' : '');
    const sf = S.sel ? all.find(f => f.id === S.sel) : null;
    let dr = { show: false };
    if (sf) {
      const ro = reOf(sf), imp = sf.origem === 'Importada';
      const docs = (imp ? [{ n: sf.arq, ext: sf.arq.endsWith('.pdf') ? 'PDF' : 'DOCX', c: sf.arq.endsWith('.pdf') ? '#C70602' : '#24508F', m: 'Ficha original · importada em ' + sf.imp + ' por Luiza Martins' }] : [{ n: 'Ficha_' + sf.id + '.pdf', ext: 'PDF', c: '#C70602', m: 'Gerada pelo sistema a partir da manifestação' }]).concat(Array.from({ length: sf.evid }, (_, i) => ({ n: ['foto_embalagem_recebida.jpg', 'nota_fiscal_' + (4400 + i) + '.pdf', 'registro_conferencia.pdf'][i % 3], ext: i % 3 === 0 ? 'JPG' : 'PDF', c: i % 3 === 0 ? '#0E7C86' : '#C70602', m: 'Evidência · anexada por ' + sf.col })));
      dr = { show: true, id: sf.id, emp: EMPL[sf.emp], data: dt(sf), or: OR[sf.origem], st: stP(sf.status), re: isRe(sf), reN: String(ro.length), reIds: ro.map(x => x.id).join(', '),
        f: [['Cliente', sf.cli], ['CNPJ', sf.cnpj], ['Tipo', sf.tipo], ['Motivo', sf.motivo], ['Colaborador responsável', sf.col], ['Empresa', EMPL[sf.emp]], ['Data da reclamação', dt(sf)], ['Arquivada em', MN[sf.mes] + '/' + sf.ano]].map(([l, v]) => ({ l, v })),
        desc: imp ? 'Conteúdo disponível no documento original anexado. Ficha anterior à ferramenta.' : 'Cliente relata: ' + sf.motivo.toLowerCase() + '. Registro feito pelo SAC no Assistente SAC.', trat: sf.trat ? (imp ? 'Tratativa registrada na ficha original.' : 'Tratativa concluída pelo setor responsável e devolutiva enviada ao cliente.') : 'Tratativa em andamento.',
        docs, noDocs: !docs.length, hist: (imp ? [{ at: sf.imp, t: 'Ficha histórica importada (' + sf.arq + ')' }, { at: dt(sf), t: 'Data da reclamação original' }] : [{ at: dt(sf) + ' 09:10', t: 'Manifestação registrada por ' + sf.col }].concat(sf.trat ? [{ at: dt(sf) + ' 16:40', t: 'Tratativa concluída' }] : [])).reverse(),
        pdf: () => this.flash('PDF da ficha ' + sf.id + ' gerado.') };
    }
    const today = '2026-10-05';
    const im = { show: S.imp, files: S.files.map((x, i) => { const up = (k, v) => this.setState(s => ({ files: s.files.map((y, j) => j === i ? Object.assign({}, y, { [k]: v }) : y) })); return { n: x.n, m: x.data ? 'Lido do documento · confira empresa e data' : 'Data não identificada · preencha antes de importar', mc: x.data ? '#666464' : '#A80502', emp: x.emp, data: x.data, tipo: x.tipo, dbc: x.data ? '#D6D6D6' : '#C70602', onEmp: e => up('emp', e.target.value), onData: e => up('data', e.target.value), onTipo: e => up('tipo', e.target.value), del: () => this.setState(s => ({ files: s.files.filter((_, j) => j !== i) })) }; }),
      pick: () => this.setState(s => { const ex = [['Ficha reclamação Mercado Exemplo 14-02-2024.pdf', 'Chiacchio', '2024-02-14'], ['FR_Plaschio_Distribuidora Alfa_set23.docx', 'Plaschio', '2023-09-20'], ['ficha_reclamacao_digitalizada_007.pdf', 'Tubahia', '']]; const nx = ex[s.files.length % 3]; return { files: s.files.concat([{ n: nx[0], emp: nx[1], data: nx[2], tipo: 'Reclamação' }]) }; }),
      okL: S.busy ? 'Importando…' : 'Importar ' + (S.files.length || '') + (S.files.length === 1 ? ' ficha' : ' fichas'), okBg: S.files.length && S.files.every(x => x.data) ? '#C70602' : '#C4C4C4',
      ok: () => { if (!S.files.length) return this.flash('Selecione ao menos um arquivo.'); if (S.files.some(x => !x.data)) return this.flash('Preencha a data da reclamação de todos os arquivos.'); if (S.files.some(x => x.data > today)) return this.flash('A data da reclamação não pode ser futura.'); this.setState({ busy: true }); setTimeout(() => { const db = JSON.parse(JSON.stringify(S.db)); const n = S.files.length; S.files.forEach(x => { const [y, m, d] = x.data.split('-').map(Number); db.fichas.push({ id: 'HIST-' + y + '-' + String(db.seq.h++).padStart(3, '0'), emp: x.emp, ano: y, mes: m, dia: d, cli: 'A identificar no documento', cnpj: '—' + Math.random(), tipo: x.tipo, motivo: 'Ver ficha original', col: 'Luiza Martins', origem: 'Importada', status: 'Concluída', evid: 0, trat: true, arq: x.n, imp: '05/10/2026 10:15' }); }); this.save(db); this.setState({ db, busy: false, imp: false, files: [] }); this.flash(n + (n === 1 ? ' ficha importada e arquivada' : ' fichas importadas e arquivadas') + ' pela data da reclamação.'); }, 700); } };
    return { nav, q: S.q, onQ: e => this.setState({ q: e.target.value, limit: 25 }), selects, clear: () => this.setState({ f: this.F0(), q: '', limit: 25 }), kpis, emps, months, tree,
      listTitle, countTxt: 'Mostrando ' + rows.length + ' de ' + list.length, cols: ['Protocolo', 'Data', 'Empresa', 'Cliente', 'Tipo', 'Motivo', 'Origem', 'Evidências', 'Status'], rows, empty: !list.length, more: list.length > S.limit, loadMore: () => this.setState({ limit: S.limit + 25 }),
      dr, closeDr: () => this.setState({ sel: null }), stop: e => e.stopPropagation(),
      im, empO: EMP, tipoO: ['Reclamação', 'Sugestão', 'Solicitação', 'Elogio'], openImport: () => this.setState({ imp: true, files: [] }), closeImport: () => this.setState({ imp: false, files: [] }),
      refreshL: S.busy ? 'Atualizando…' : '↻ Atualizar', refresh: () => { this.setState({ busy: true }); setTimeout(() => { this.setState({ busy: false }); this.flash('Arquivo atualizado com as manifestações mais recentes.'); }, 600); },
      toast: S.toast };
  }
}
</script>
</body>
</html>

````
