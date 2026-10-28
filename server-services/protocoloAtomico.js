'use strict';

const fichaUnica = require('./fichaUnica');

let _prisma = null;
let _readExistingMax = null;

function init({ prisma, readExistingMax } = {}) {
  _prisma = prisma || null;
  _readExistingMax = typeof readExistingMax === 'function' ? readExistingMax : null;
}

function indisponivel() {
  return Object.assign(new Error('Emissão de protocolo temporariamente indisponível.'), {
    code: 'PROTOCOLO_STORAGE_UNAVAILABLE', status: 503,
  });
}

function normalizarChave(valor) {
  const key = String(valor || '').trim();
  if (!key || key.length > 160) {
    throw Object.assign(new Error('Chave de idempotência obrigatória para emissão do protocolo.'), {
      code: 'IDEMPOTENCY_KEY_REQUIRED', status: 400,
    });
  }
  return key;
}

function conflitoIdempotencia() {
  return Object.assign(new Error('A chave de idempotência já foi usada para outra manifestação.'), {
    code: 'IDEMPOTENCY_KEY_CONFLICT', status: 409,
  });
}

async function buscarReserva(idempotencyKey) {
  if (!_prisma) throw indisponivel();
  const key = normalizarChave(idempotencyKey);
  const rows = await _prisma.$queryRaw`
    SELECT idempotency_key, chave, protocolo, seq, status, entity_id, last_error
      FROM protocol_reservation
     WHERE idempotency_key = ${key}
     LIMIT 1`;
  return rows[0] || null;
}

async function gerarProtocolo(empresa, canal, agora = new Date(), options = {}) {
  if (!_prisma) throw indisponivel();
  const idempotencyKey = normalizarChave(options.idempotencyKey);
  const dataObj = agora instanceof Date ? agora : new Date(agora);
  if (Number.isNaN(dataObj.getTime())) throw new Error('Data inválida para emissão do protocolo.');
  const chave = `${fichaUnica.prefixoEmpresa(empresa)}-${fichaUnica.dataProtocolo(dataObj)}-${fichaUnica.codigoCanal(canal)}`;
  const contadorAtual = await _prisma.$queryRaw`SELECT seq FROM protocol_counter WHERE chave = ${chave} LIMIT 1`;
  const floor = contadorAtual[0] ? 0 : Math.max(0, Number(await _readExistingMax?.(`${chave}-`)) || 0);

  const reservar = async tx => {
    const existente = await tx.$queryRaw`
      SELECT idempotency_key, chave, protocolo, seq, status, entity_id
        FROM protocol_reservation
       WHERE idempotency_key = ${idempotencyKey}
       LIMIT 1`;
    if (existente[0]) {
      if (existente[0].chave !== chave) throw conflitoIdempotencia();
      return existente[0].protocolo;
    }

    const contador = await tx.$queryRaw`
      INSERT INTO protocol_counter (chave, seq)
      VALUES (${chave}, ${floor + 1})
      ON CONFLICT (chave) DO UPDATE SET seq = GREATEST(protocol_counter.seq, ${floor}) + 1
      RETURNING seq`;
    const seq = Number(contador[0]?.seq);
    if (!Number.isSafeInteger(seq) || seq < 1) throw new Error('Contador de protocolo retornou valor inválido.');
    const protocolo = fichaUnica.montarProtocolo({ empresa, canal, data: dataObj, sequencial: seq });
    await tx.$executeRaw`
      INSERT INTO protocol_reservation
        (idempotency_key, chave, protocolo, seq, status, created_at, updated_at)
      VALUES (${idempotencyKey}, ${chave}, ${protocolo}, ${seq}, 'RESERVED', NOW(), NOW())`;
    return protocolo;
  };

  try {
    return await _prisma.$transaction(reservar);
  } catch (e) {
    if (e?.code === 'IDEMPOTENCY_KEY_CONFLICT') throw e;
    if (e?.code === '23505' || e?.code === 'P2002') {
      const existente = await buscarReserva(idempotencyKey);
      if (existente?.chave !== chave) throw conflitoIdempotencia();
      if (existente?.protocolo) return existente.protocolo;
    }
    throw e;
  }
}

async function confirmarPersistencia(idempotencyKey, entityId) {
  if (!_prisma) throw indisponivel();
  const key = normalizarChave(idempotencyKey);
  await _prisma.$executeRaw`
    UPDATE protocol_reservation
       SET status = 'PERSISTED', entity_id = ${String(entityId || '')}, last_error = NULL, updated_at = NOW()
     WHERE idempotency_key = ${key}`;
}

async function registrarFalhaPersistencia(idempotencyKey, erro) {
  if (!_prisma) return;
  const key = normalizarChave(idempotencyKey);
  await _prisma.$executeRaw`
    UPDATE protocol_reservation
       SET status = 'PERSISTENCE_FAILED', last_error = ${String(erro?.message || erro || '').slice(0, 500)}, updated_at = NOW()
     WHERE idempotency_key = ${key}`;
}

module.exports = { init, gerarProtocolo, buscarReserva, confirmarPersistencia, registrarFalhaPersistencia };
