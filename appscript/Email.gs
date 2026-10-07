// ============================================================
// Email.gs — Envio de e-mails via GmailApp / MailApp
// Substitui o serviço Resend do Node.js
// ============================================================

function enviarEmail(para, assunto, htmlBody) {
  try {
    GmailApp.sendEmail(para, assunto, '', { htmlBody: htmlBody, name: 'SAC Grupo Chiacchio' });
    return true;
  } catch(e) {
    // Fallback para MailApp se GmailApp falhar
    try {
      MailApp.sendEmail({ to: para, subject: assunto, htmlBody: htmlBody, name: 'SAC Grupo Chiacchio' });
      return true;
    } catch(e2) {
      Logger.log('Erro ao enviar e-mail: ' + e2.message);
      return false;
    }
  }
}

function enviarNotificacaoRNC(destinatario, rnc, tipo) {
  var assuntos = {
    'ENVIADA': 'Nova RNC para análise — ' + (rnc.ID_RNC || ''),
    'APROVADA': 'RNC aprovada — ' + (rnc.ID_RNC || ''),
    'DEVOLVIDA': 'RNC devolvida para correção — ' + (rnc.ID_RNC || ''),
    'ENCERRADA': 'RNC encerrada — ' + (rnc.ID_RNC || ''),
  };
  var assunto = assuntos[tipo] || 'Atualização de RNC — ' + (rnc.ID_RNC || '');
  var body = '<p>Olá,</p><p>A RNC <strong>' + (rnc.ID_RNC || '') + '</strong> foi atualizada.</p>' +
    '<p>Não conformidade: ' + (rnc.NAO_CONFORMIDADE || '') + '</p>' +
    '<p>Status: ' + (rnc.STATUS || '') + '</p>' +
    '<p>Acesse o sistema SAC para mais detalhes.</p>';
  return enviarEmail(destinatario, assunto, body);
}

function enviarNotificacaoManifestacao(destinatario, manifestacao, tipo) {
  var assunto = 'Atualização de manifestação — ' + (manifestacao.ID_MANIFESTACAO || '');
  var body = '<p>Olá,</p><p>A manifestação <strong>' + (manifestacao.ID_MANIFESTACAO || '') + '</strong> foi atualizada.</p>' +
    '<p>Status: ' + (manifestacao.STATUS || '') + '</p>' +
    '<p>Acesse o sistema SAC para mais detalhes.</p>';
  return enviarEmail(destinatario, assunto, body);
}
