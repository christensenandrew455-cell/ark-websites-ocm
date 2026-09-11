import assert from 'node:assert/strict';
import test from 'node:test';
import { admitReceptionistCall, CALLER_COOLDOWN_MS, CALL_RECORD_RETENTION_MS, normalizeCallerPhone } from '../app/lib/receptionistCallAdmission.js';
import { cleanupReceptionistCallState, flushReceptionistCallEvents } from '../app/lib/receptionistCallEventOutbox.js';
import { memoryFirestore } from './helpers/memory-firestore.mjs';

const now = Date.parse('2026-09-11T12:00:00Z');
const secret = 'test-only-key';
function body(id, from = '+15085550123', to = '+17742316164') {
  return { data: { event_type: 'call.initiated', occurred_at: new Date(now).toISOString(), payload: { call_control_id: id, direction: 'incoming', from, to } } };
}
const request = (db, id, options = {}) => admitReceptionistCall({ db, body: body(id), clientId: 'ark-demo', now, secret, ...options });
const outboxRows = (db) => [...db.rows].filter(([key]) => key.includes('/receptionistCallEventOutbox/'));

test('simultaneous calls across both destinations admit only one and persist one generic event', async () => {
  const db = memoryFirestore();
  const results = await Promise.all([
    request(db, 'one'),
    request(db, 'two', { clientId: 'tabor-painting', body: body('two', '(508) 555-0123', '+15085550999') }),
  ]);
  assert.equal(results.filter((result) => result.allowed).length, 1);
  assert.equal(results.find((result) => !result.allowed).retryAfterSeconds, 900);
  assert.equal(outboxRows(db).length, 1);
  const persisted = JSON.stringify([...db.rows]);
  assert.equal(persisted.includes('5085550123'), false);
  assert.equal(persisted.includes('17742316164'), false);
  assert.deepEqual(outboxRows(db)[0][1].event.metadata, {});
});

test('a restarted process preserves cooldown; blocked retries do not extend it', async () => {
  const db = memoryFirestore();
  await request(db, 'first');
  const restarted = memoryFirestore(db.rows);
  assert.equal((await request(restarted, 'blocked', { now: now + 899_000 })).allowed, false);
  assert.equal((await request(restarted, 'new', { now: now + CALLER_COOLDOWN_MS })).allowed, true);
  assert.equal((await request(restarted, 'blocked', { now: now + 2 * CALLER_COOLDOWN_MS })).allowed, false);
  assert.equal(outboxRows(db).length, 2);
});

test('redelivery keeps the original deadline and event; other callers remain independent', async () => {
  const db = memoryFirestore();
  const first = await request(db, 'first');
  const retry = await request(db, 'first', { now: now + 30_000 });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.eventId, first.eventId);
  assert.equal(outboxRows(db).length, 1);
  assert.equal((await request(db, 'other', { body: body('other', '+15085550888') })).allowed, true);
  assert.equal((await request(db, 'fresh', { now: now + CALLER_COOLDOWN_MS })).allowed, true);
  assert.equal((await request(db, 'first', { now: now + CALLER_COOLDOWN_MS })).allowed, false);
});

test('missing identities, malformed numbers and non-incoming events cannot start calls', async () => {
  const db = memoryFirestore();
  for (const phone of ['', 'anonymous', 'sip:5085550123@example.com', '+123', '0000000000']) {
    assert.equal(normalizeCallerPhone(phone), '');
    assert.equal((await request(db, phone, { body: body('call', phone) })).code, 'CALLER_ID_REQUIRED');
  }
  for (const data of [
    { ...body('x').data, event_type: 'call.answered' },
    { ...body('x').data, payload: { ...body('x').data.payload, direction: 'outgoing' } },
  ]) assert.equal((await request(db, 'x', { body: { data } })).allowed, false);
  assert.equal((await request(db, '', { body: body('') })).code, 'CALL_ID_REQUIRED');
  assert.equal(db.rows.size, 0);
});

test('failed notification delivery survives restart and retries the same event once', async () => {
  const db = memoryFirestore();
  const admitted = await request(db, 'one');
  const attempts = [];
  await flushReceptionistCallEvents({ db, now, send: async (event) => { attempts.push(event.id); throw new Error('network failed'); } });
  assert.equal(outboxRows(db).length, 1);
  const restarted = memoryFirestore(db.rows);
  const send = async (event) => { attempts.push(event.id); return { delivered: true }; };
  await Promise.all([
    flushReceptionistCallEvents({ db: restarted, now: now + 60_000, send }),
    flushReceptionistCallEvents({ db: restarted, now: now + 60_000, send }),
  ]);
  assert.deepEqual(attempts, [admitted.eventId, admitted.eventId]);
  assert.equal(outboxRows(db).length, 0);
  await request(restarted, 'one', { now: now + 60_000 });
  assert.equal(outboxRows(db).length, 0, 'redelivery must not recreate a delivered alert');
});

test('expired events are discarded and expired call state is removed', async () => {
  const db = memoryFirestore();
  await request(db, 'one');
  const later = now + CALL_RECORD_RETENTION_MS + 1;
  await flushReceptionistCallEvents({ db, now: later, send: async () => assert.fail('expired alert sent') });
  await cleanupReceptionistCallState({ db, now: later });
  assert.equal(db.rows.size, 0);
});
