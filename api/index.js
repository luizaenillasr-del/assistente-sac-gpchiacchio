const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Rotas
app.use('/api/manifestacoes', require('./routes/manifestacoes'));
app.use('/api/historico', require('./routes/historico'));
app.use('/api/setores', require('./routes/setores'));
app.use('/api/conhecimento', require('./routes/conhecimento'));

app.get('/', (req, res) => {
  res.json({ status: 'ok', versao: '1.0.0', sistema: 'Assistente SAC Chiacchio' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

module.exports = app;
