'use strict';

const PDFDocument = require('pdfkit');

function texto(valor) { return String(valor == null || valor === '' ? '—' : valor); }

function gerarPdfRelatorioSatisfacao(relatorio) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size:'A4', margin:48, info:{ Title:`Relatório de Satisfação — ${texto(relatorio.empresa)}` } });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const titulo = 'RELATÓRIO DE PESQUISA DE SATISFAÇÃO DE CLIENTES';
      doc.fillColor('#C70602').fontSize(16).font('Helvetica-Bold').text(titulo);
      doc.moveDown(.4).fillColor('#333').fontSize(10).font('Helvetica')
        .text(`${texto(relatorio.empresa)} · ${texto(relatorio.periodo)} · Versão ${texto(relatorio.versao)}`)
        .text(`Status: ${texto(relatorio.status)}`);
      doc.moveDown().strokeColor('#E4E4E4').moveTo(48, doc.y).lineTo(547, doc.y).stroke();
      doc.moveDown(.7).font('Helvetica-Bold').fontSize(12).fillColor('#222').text('Indicador principal');
      doc.moveDown(.3).font('Helvetica').fontSize(11).text(`Satisfação do mês: ${texto(relatorio.indicador)}`)
        .text(`NPS: ${texto(relatorio.nps)}`).text(`Meta: ${texto(relatorio.meta)}`);
      const criterios = relatorio.criterios || [];
      if (criterios.length) {
        doc.moveDown().font('Helvetica-Bold').fontSize(12).text('Resultados por critério');
        doc.moveDown(.3).font('Helvetica');
        criterios.forEach(c => doc.text(`${texto(c.criterio)}: ${texto(c.media)}`));
      }
      const textos = relatorio.textos || {};
      const secoes = [
        ['resumo_executivo','Resumo executivo'], ['desempenho','Desempenho geral'],
        ['analise_critica','Análise mensal dos resultados'], ['pontos_fortes','Pontos fortes'],
        ['oportunidades','Pontos de melhoria'], ['acoes','Ações realizadas e recomendações']
      ];
      secoes.forEach(([campo, tituloSecao]) => {
        if (!textos[campo]) return;
        doc.moveDown().font('Helvetica-Bold').fontSize(12).text(tituloSecao);
        doc.moveDown(.25).font('Helvetica').fontSize(10).fillColor('#333').text(String(textos[campo]), { lineGap:3 });
      });
      doc.end();
    } catch (erro) { reject(erro); }
  });
}

module.exports = { gerarPdfRelatorioSatisfacao };
