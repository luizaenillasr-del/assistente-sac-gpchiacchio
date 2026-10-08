'use strict';
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

// Logo Grupo Chiacchio — lido em runtime do arquivo físico
const LOGO_BUF = (() => {
  try { return fs.readFileSync(path.join(__dirname, '../../public/logo-chiacchio.png')); }
  catch (e) { return null; }
})();

const RED = '#C8102E';
const DARK = '#1A0508';
const GRAY = '#6B7280';
const LIGHT_GRAY = '#F3F4F6';
const BORDER = '#D1D5DB';

function linha(doc, y, x1, x2, cor = BORDER) {
  doc.save().moveTo(x1, y).lineTo(x2, y).strokeColor(cor).lineWidth(0.5).stroke().restore();
}

function caixaTitulo(doc, y, titulo, w, ml) {
  doc.save()
    .rect(ml, y, w, 18).fillColor(DARK).fill()
    .fillColor('white').fontSize(8).font('Helvetica-Bold')
    .text(titulo, ml + 6, y + 5, { width: w - 12 })
    .restore();
  return y + 18;
}

function campo(doc, label, valor, x, y, largura, altura = 28, ultimo = false) {
  doc.save()
    .rect(x, y, largura, altura).strokeColor(BORDER).lineWidth(0.5).stroke()
    .fillColor(GRAY).fontSize(7).font('Helvetica')
    .text(label, x + 4, y + 4)
    .fillColor('#111827').fontSize(9).font(valor ? 'Helvetica' : 'Helvetica')
    .text(valor || '', x + 4, y + 14, { width: largura - 8, lineBreak: false, ellipsis: false })
    .restore();
  return y + altura;
}

function campoAlto(doc, label, valor, x, y, largura, altura = 56) {
  doc.save()
    .rect(x, y, largura, altura).strokeColor(BORDER).lineWidth(0.5).stroke()
    .fillColor(GRAY).fontSize(7).font('Helvetica')
    .text(label, x + 4, y + 4)
    .fillColor('#111827').fontSize(9).font('Helvetica')
    .text(valor || '', x + 4, y + 14, { width: largura - 8, height: altura - 18, lineBreak: true })
    .restore();
  return y + altura;
}

function checkboxes(doc, label, opcoes, selecionada, x, y, largura, altura = 28) {
  doc.save()
    .rect(x, y, largura, altura).strokeColor(BORDER).lineWidth(0.5).stroke()
    .fillColor(GRAY).fontSize(7).font('Helvetica')
    .text(label, x + 4, y + 4)
    .restore();

  const colW = (largura - 8) / opcoes.length;
  opcoes.forEach((op, i) => {
    const cx = x + 4 + i * colW;
    const cy = y + 14;
    const marcado = selecionada && (
      op.toLowerCase().includes(selecionada.toLowerCase()) ||
      selecionada.toLowerCase().includes(op.toLowerCase())
    );
    doc.save()
      .rect(cx, cy, 9, 9).strokeColor(marcado ? RED : BORDER).lineWidth(0.8).stroke();
    if (marcado) {
      doc.fillColor(RED).rect(cx + 1, cy + 1, 7, 7).fill();
    }
    doc.fillColor('#111827').fontSize(7.5).font(marcado ? 'Helvetica-Bold' : 'Helvetica')
      .text(op, cx + 12, cy + 1, { width: colW - 14 })
      .restore();
  });
  return y + altura;
}

/**
 * Gera o PDF da Ficha de Reclamação / Manifestação.
 * @param {Object} dados - campos da manifestação
 * @returns {Promise<Buffer>}
 */
async function gerarFichaPDF(dados) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const ML = 36; // margin left
    const MR = 36; // margin right
    const W = 595.28 - ML - MR; // usable width

    // ─── PÁGINA 1 ───────────────────────────────────────────────
    doc.addPage();
    let y = 28;

    // === CABEÇALHO ===
    // Faixa escura
    doc.save().rect(0, 0, 595.28, 60).fillColor(DARK).fill().restore();

    // Logo
    if (LOGO_BUF) {
      try { doc.image(LOGO_BUF, ML, 10, { height: 38, fit: [160, 38] }); } catch (e) { /* fallback abaixo */ }
    }
    if (!LOGO_BUF) {
      doc.save().fillColor('white').fontSize(14).font('Helvetica-Bold')
        .text('GRUPO CHIACCHIO', ML, 22).restore();
    }

    // Título direito
    doc.save()
      .fillColor('white').fontSize(11).font('Helvetica-Bold')
      .text('FICHA DE RECLAMAÇÃO / MANIFESTAÇÃO', ML + 170, 16, { width: W - 170, align: 'right' })
      .fillColor(RED).fontSize(8).font('Helvetica')
      .text('SAC GRUPO CHIACCHIO', ML + 170, 30, { width: W - 170, align: 'right' })
      .restore();

    y = 68;

    // Protocolo box no topo
    const protBox = ML + W - 180;
    doc.save()
      .rect(protBox, y, 180, 24).strokeColor(RED).lineWidth(1).stroke()
      .fillColor(RED).fontSize(7).font('Helvetica-Bold')
      .text('PROTOCOLO', protBox + 5, y + 4)
      .fillColor(DARK).fontSize(12).font('Helvetica-Bold')
      .text(dados.protocolo || '—', protBox + 5, y + 12)
      .restore();

    doc.save()
      .fillColor(GRAY).fontSize(7.5).font('Helvetica')
      .text(`Emitido em: ${dados.dataRegistroFmt || ''}`, ML, y + 6)
      .text(`Origem: Portal de Funcionário`, ML, y + 14)
      .restore();

    y += 32;

    // ─── 1. DADOS DO REGISTRO ────────────────────────────────────
    y = caixaTitulo(doc, y, '1. DADOS DO REGISTRO', W, ML);

    const c1W = W / 3;
    campo(doc, 'Data do Registro', dados.dataRegistroFmt, ML, y, c1W);
    campo(doc, 'Setor', dados.setorRecebimento, ML + c1W, y, c1W);
    campo(doc, 'Colaborador (Recebimento)', dados.colaboradorRecebimento, ML + c1W * 2, y, c1W);
    y += 28;

    // ─── 2. DADOS DO CLIENTE ─────────────────────────────────────
    y = caixaTitulo(doc, y + 6, '2. DADOS DO CLIENTE', W, ML);

    campo(doc, 'Nome do Cliente *', dados.nomeCliente, ML, y, W * 0.55);
    campo(doc, 'Empresa / Razão Social *', dados.empresa, ML + W * 0.55, y, W * 0.45);
    y += 28;
    campo(doc, 'Telefone / WhatsApp', dados.telefone, ML, y, W * 0.5);
    campo(doc, 'E-mail', dados.email, ML + W * 0.5, y, W * 0.5);
    y += 28;

    // ─── 3. INFORMAÇÕES DA MANIFESTAÇÃO ──────────────────────────
    y = caixaTitulo(doc, y + 6, '3. INFORMAÇÕES DA MANIFESTAÇÃO', W, ML);

    y = checkboxes(doc, 'Canal de Recebimento *',
      ['Telefone', 'WhatsApp', 'E-mail', 'Presencial', 'Comercial', 'Outro'],
      dados.canalRecebimento, ML, y, W, 30);

    if (dados.canalRecebimento === 'Outro' && dados.canalOutro) {
      campo(doc, 'Qual canal?', dados.canalOutro, ML, y, W, 22);
      y += 22;
    }

    y = checkboxes(doc, 'Tipo de Manifestação *',
      ['Reclamação', 'Dúvida', 'Sugestão', 'Elogio'],
      dados.tipoManifestacao, ML, y, W, 30);

    campo(doc, 'Motivo da Manifestação', dados.motivoManifestacao, ML, y, W, 28);
    y += 28;

    // Descrição detalhada — pode ser longa
    const descH = Math.min(Math.max(56, 14 + Math.ceil((dados.descricaoOriginal || '').length / 80) * 11), 140);
    y = campoAlto(doc, 'Descrição Detalhada da Manifestação *', dados.descricaoOriginal, ML, y, W, descH);

    // ─── 4. INFORMAÇÕES DO PRODUTO ───────────────────────────────
    // Se não cabe na página, adicionar nova página
    if (y > 690) {
      doc.addPage();
      y = 36;
    } else {
      y += 6;
    }

    y = caixaTitulo(doc, y, '4. INFORMAÇÕES DO PRODUTO (quando aplicável)', W, ML);
    doc.save().fillColor(GRAY).fontSize(7.5).font('Helvetica-Oblique')
      .text('Preencha quando aplicável', ML + 6, y + 1).restore();
    y += 10;

    const p1W = W / 3;
    campo(doc, 'Produto', dados.produto, ML, y, p1W);
    campo(doc, 'Lote', dados.lote, ML + p1W, y, p1W);
    campo(doc, 'Qtd. Afetada', dados.quantidadeAfetada, ML + p1W * 2, y, p1W);
    y += 28;

    // ─── 5. ENCAMINHAMENTO ────────────────────────────────────────
    y += 6;
    y = caixaTitulo(doc, y, '5. ENCAMINHAMENTO', W, ML);
    campo(doc, 'Data de Encaminhamento ao SAC', dados.dataEncaminhamentoSAC || dados.dataRegistroFmt, ML, y, W * 0.5);
    campo(doc, 'Status Inicial', 'NOVA / AGUARDANDO TRIAGEM', ML + W * 0.5, y, W * 0.5);
    y += 28;

    const obsH = Math.max(40, Math.min(80, 14 + Math.ceil((dados.observacoes || '').length / 90) * 11));
    y = campoAlto(doc, 'Observações Adicionais', dados.observacoes, ML, y, W, obsH);

    // Evidências
    y += 6;
    if (dados.totalEvidencias > 0) {
      doc.save()
        .rect(ML, y, W, 22).strokeColor(BORDER).lineWidth(0.5).stroke()
        .fillColor(GRAY).fontSize(7).font('Helvetica')
        .text('Evidências e Anexos', ML + 4, y + 4)
        .fillColor('#111827').fontSize(9)
        .text(`${dados.totalEvidencias} arquivo(s) anexado(s) à manifestação no sistema.`, ML + 4, y + 13)
        .restore();
      y += 22;
    }

    // ─── RODAPÉ ─────────────────────────────────────────────────
    const footY = 820;
    linha(doc, footY, ML, ML + W, BORDER);
    doc.save()
      .fillColor(GRAY).fontSize(7.5).font('Helvetica')
      .text('SAC GRUPO CHIACCHIO · Este documento é uma versão digital da Ficha de Reclamação / Manifestação.', ML, footY + 5, { width: W * 0.7 })
      .text(`Protocolo: ${dados.protocolo || '—'} · ${dados.dataRegistroFmt || ''}`, ML + W * 0.7, footY + 5, { width: W * 0.3, align: 'right' })
      .restore();

    doc.end();
  });
}

module.exports = { gerarFichaPDF };
