'use strict';

const counters = new Map();
const reservations = new Map();
let queue = Promise.resolve();
const sql = strings => strings.join(' ').replace(/\s+/g,' ').trim();

const client = {
  async $queryRaw(strings,...values) {
    const query = sql(strings);
    if (query.includes('FROM protocol_reservation')) {
      const row = reservations.get(String(values[0]));
      return row ? [{...row}] : [];
    }
    if (query.includes('FROM protocol_counter')) {
      const seq=counters.get(String(values[0]));
      return seq ? [{seq}] : [];
    }
    if (query.includes('INSERT INTO protocol_counter')) {
      const key=String(values[0]);
      const floor=Number(values[1]||0)-1;
      const seq=Math.max(counters.get(key)||0,floor)+1;
      counters.set(key,seq);
      return [{seq}];
    }
    throw new Error(`SQL de protocolo não simulado: ${query}`);
  },
  async $executeRaw(strings,...values) {
    const query=sql(strings);
    if (query.includes('INSERT INTO protocol_reservation')) {
      const [idempotency_key,chave,protocolo,seq]=values;
      reservations.set(String(idempotency_key),{idempotency_key:String(idempotency_key),chave,protocolo,seq,status:'RESERVED',entity_id:null});
      return 1;
    }
    if (query.includes("status = 'PERSISTED'")) {
      const [entity_id,key]=values;
      Object.assign(reservations.get(String(key)),{status:'PERSISTED',entity_id:String(entity_id),last_error:null});
      return 1;
    }
    if (query.includes("status = 'PERSISTENCE_FAILED'")) {
      const [last_error,key]=values;
      Object.assign(reservations.get(String(key)),{status:'PERSISTENCE_FAILED',last_error:String(last_error)});
      return 1;
    }
    throw new Error(`SQL de protocolo não simulado: ${query}`);
  },
  $transaction(fn) {
    const run=queue.then(()=>fn(client));
    queue=run.catch(()=>{});
    return run;
  },
  reset() { counters.clear(); reservations.clear(); queue=Promise.resolve(); },
};

module.exports=client;
