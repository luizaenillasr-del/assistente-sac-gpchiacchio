// ============================================================
// Sheets.gs — Operações CRUD na planilha Google Sheets
// Equivalente ao bloco de lerAba/appendObjeto/atualizarPorID do Node.js
// ============================================================

// Cache em memória por execução (equivalente ao _lerAbaCache do Node.js)
var _sheetCache = {};
var _sheetCacheTs = {};
var CACHE_TTL_MS = 60000; // 60 segundos

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function lerAba(nomeAba, maxRows) {
  var cacheKey = nomeAba + '|' + (maxRows || '');
  var now = Date.now();
  if (_sheetCache[cacheKey] && (now - _sheetCacheTs[cacheKey]) < CACHE_TTL_MS) {
    return _sheetCache[cacheKey];
  }
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(nomeAba);
  if (!sheet) { return []; }
  var lastRow = maxRows ? Math.min(maxRows, sheet.getLastRow()) : sheet.getLastRow();
  if (lastRow < 2) { return []; }
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) { return []; }
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0];
  var data = [];
  for (var i = 1; i < values.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      if (headers[j]) {
        var v = values[i][j];
        obj[headers[j]] = (v instanceof Date) ? v.toISOString() : (v === null || v === undefined ? '' : String(v));
      }
    }
    data.push(obj);
  }
  _sheetCache[cacheKey] = data;
  _sheetCacheTs[cacheKey] = now;
  return data;
}

function invalidarCacheAba(nomeAba) {
  Object.keys(_sheetCache).forEach(function(k) {
    if (k.indexOf(nomeAba + '|') === 0) {
      delete _sheetCache[k];
      delete _sheetCacheTs[k];
    }
  });
}

function lerAbaReclamacoes(max) {
  max = max || 2000;
  var r1 = [];
  try { r1 = lerAba('Reclamações + devolutiva', max); } catch(e) {}
  if (r1.length > 0) return r1;
  var r2 = [];
  try { r2 = lerAba('Reclamações', max); } catch(e) {}
  return r2;
}

function obterCabecalhos(nomeAba) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(nomeAba);
  if (!sheet || sheet.getLastColumn() < 1) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
}

function appendLinha(nomeAba, linha) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(nomeAba);
  if (!sheet) throw new Error('Aba "' + nomeAba + '" não encontrada.');
  sheet.appendRow(linha);
  invalidarCacheAba(nomeAba);
}

function appendObjeto(nomeAba, objeto) {
  var headers = obterCabecalhos(nomeAba);
  if (!headers.length) throw new Error('A aba "' + nomeAba + '" não possui cabeçalhos.');
  var linha = headers.map(function(h) { return objeto[h] !== undefined ? objeto[h] : ''; });
  appendLinha(nomeAba, linha);
  return { headers: headers, linha: linha };
}

function updateLinha(nomeAba, rowIndex, linha) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(nomeAba);
  if (!sheet) throw new Error('Aba "' + nomeAba + '" não encontrada.');
  sheet.getRange(rowIndex, 1, 1, linha.length).setValues([linha]);
  invalidarCacheAba(nomeAba);
}

function atualizarPorID(nomeAba, id, dados, camposID) {
  camposID = camposID || ['ID_MANIFESTACAO','ID_RNC','ID_APROVADOR','ID_SUGESTAO','ID_ANEXO','ID_EVENTO'];
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(nomeAba);
  if (!sheet || sheet.getLastRow() < 2) return null;
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(String);
  var idCol = null;
  for (var ci = 0; ci < camposID.length; ci++) {
    if (headers.indexOf(camposID[ci]) >= 0) { idCol = camposID[ci]; break; }
  }
  if (!idCol) return null;
  var idIdx = headers.indexOf(idCol);
  var rowIndex = -1;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idIdx] || '').trim() === String(id).trim()) { rowIndex = i + 1; break; }
  }
  if (rowIndex < 0) return null;
  var valores = values[rowIndex - 1].slice();
  headers.forEach(function(h, i) {
    if (Object.prototype.hasOwnProperty.call(dados, h)) valores[i] = dados[h];
  });
  updateLinha(nomeAba, rowIndex, valores);
  return { rowIndex: rowIndex, headers: headers, valores: valores };
}

function buscarPorID(nomeAba, id, camposID) {
  camposID = camposID || ['ID_MANIFESTACAO','ID_RNC','ID_SETOR','ID'];
  var dados = [];
  try { dados = lerAba(nomeAba, 5000); } catch(e) {}
  return dados.find(function(r) {
    return camposID.some(function(c) { return String(r[c] || '').trim() === String(id).trim(); });
  }) || null;
}

function gerarProximoID(nomeAba, prefixo, campoID) {
  var ts = new Date().getTime().toString(36).toUpperCase();
  var rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return prefixo + '-' + ts + rand;
}

function garantirAbaComCabecalhos(nomeAba, cabecalhos) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(nomeAba);
  if (!sheet) {
    sheet = ss.insertSheet(nomeAba);
    sheet.appendRow(cabecalhos);
    return;
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(cabecalhos);
  }
}

function registrarAuditoria(usuario, acao, idManifestacao, entidade, valorAnterior, valorNovo) {
  try {
    var linha = [
      new Date().toISOString(),
      usuario || 'sistema',
      acao,
      idManifestacao || '',
      entidade || '',
      typeof valorAnterior === 'object' ? JSON.stringify(valorAnterior) : (valorAnterior || ''),
      typeof valorNovo === 'object' ? JSON.stringify(valorNovo) : (valorNovo || ''),
    ];
    garantirAbaComCabecalhos('LOG_SISTEMA', ['DATA','USUARIO','ACAO','ID_MANIFESTACAO','ENTIDADE','VALOR_ANTERIOR','VALOR_NOVO']);
    appendLinha('LOG_SISTEMA', linha);
  } catch(e) { Logger.log('Erro auditoria: ' + e.message); }
}

function filtrarPorEmpresa(itens, userEmpresa, campoEmpresa) {
  if (!userEmpresa) return itens;
  var userCod = empresaCanonica(userEmpresa);
  if (!userCod || userCod === 'MASTER') return itens;
  return itens.filter(function(item) {
    var val = item[campoEmpresa] || '';
    if (!val) return false;
    return empresaCanonica(val) === userCod;
  });
}

function filtrarPorEmpresaHistorico(itens, userEmpresa, campoEmpresa) {
  if (!userEmpresa) return itens;
  var userCod = empresaCanonica(userEmpresa);
  if (!userCod || userCod === 'MASTER') return itens;
  return itens.filter(function(item) {
    var val = item[campoEmpresa] || '';
    if (!val) return true;
    return empresaCanonica(val) === userCod;
  });
}

function filtrarPorEmpresaConfig(itens, userEmpresa, campoEmpresa) {
  campoEmpresa = campoEmpresa || 'EMPRESA';
  if (!userEmpresa) return itens;
  var userCod = empresaCanonica(userEmpresa);
  if (!userCod || userCod === 'MASTER') return itens;
  return itens.filter(function(item) {
    var val = item[campoEmpresa] || '';
    if (!val) return true;
    return empresaCanonica(val) === userCod;
  });
}

// Planilha de pesquisas (separada)
function lerAbaPesquisa(nomeAba, maxRows) {
  var ssId = PESQUISA_SPREADSHEET_ID || SPREADSHEET_ID;
  var ss = SpreadsheetApp.openById(ssId);
  var sheet = ss.getSheetByName(nomeAba);
  if (!sheet) return [];
  var lastRow = maxRows ? Math.min(maxRows, sheet.getLastRow()) : sheet.getLastRow();
  if (lastRow < 2) return [];
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0];
  return values.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) {
      if (h) {
        var v = row[i];
        obj[h] = (v instanceof Date) ? v.toISOString() : (v === null || v === undefined ? '' : String(v));
      }
    });
    return obj;
  });
}
