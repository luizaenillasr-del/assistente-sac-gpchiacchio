// ============================================================
// Drive.gs — Upload e gestão de arquivos no Google Drive
// Substitui o uploadArquivoDrive do Node.js
// ============================================================

function uploadArquivoDrive(nome, mimeType, base64) {
  var bytes = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(bytes, mimeType, nome);
  var folder = null;
  if (DRIVE_FOLDER_ID) {
    try { folder = DriveApp.getFolderById(DRIVE_FOLDER_ID); } catch(e) {}
  }
  var file = folder ? folder.createFile(blob) : DriveApp.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return {
    id: file.getId(),
    name: file.getName(),
    webViewLink: 'https://drive.google.com/file/d/' + file.getId() + '/view',
    webContentLink: 'https://drive.google.com/uc?id=' + file.getId(),
  };
}

function gerarPDFFicha(htmlContent, nomeArquivo) {
  // Cria um Google Doc temporário e exporta como PDF
  var doc = DocumentApp.create(nomeArquivo || 'ficha-sac');
  var body = doc.getBody();
  body.setText('PDF gerado pelo sistema SAC');
  doc.saveAndClose();

  var docId = doc.getId();
  var url = 'https://docs.google.com/document/d/' + docId + '/export?format=pdf';
  var options = {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  };
  var resp = UrlFetchApp.fetch(url, options);
  var pdfBlob = resp.getBlob().setName((nomeArquivo || 'ficha') + '.pdf');

  // Remove o doc temporário
  try { DriveApp.getFileById(docId).setTrashed(true); } catch(e) {}

  // Salva o PDF no Drive
  var folder = null;
  if (DRIVE_FOLDER_ID) {
    try { folder = DriveApp.getFolderById(DRIVE_FOLDER_ID); } catch(e) {}
  }
  var pdfFile = folder ? folder.createFile(pdfBlob) : DriveApp.createFile(pdfBlob);
  pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    id: pdfFile.getId(),
    name: pdfFile.getName(),
    webViewLink: 'https://drive.google.com/file/d/' + pdfFile.getId() + '/view',
    webContentLink: 'https://drive.google.com/uc?id=' + pdfFile.getId(),
  };
}
