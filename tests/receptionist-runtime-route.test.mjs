import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { memoryFirestore } from './helpers/memory-firestore.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
process.env.TELNYX_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' });
process.env.CALLER_COOLDOWN_SECRET = 'test-cooldown-key';
process.env.DEMO_PHONE_NUMBER = '+17742316164';
const db = memoryFirestore();
const afterTasks = [];
globalThis.__arkRuntimeTest = { db, afterTasks };
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    let source;
    if (specifier === 'next/server') source = 'export const NextResponse = Response; export const after = (fn) => globalThis.__arkRuntimeTest.afterTasks.push(fn);';
    if (specifier.endsWith('/firebase-admin')) source = 'export const getAdminDb = () => globalThis.__arkRuntimeTest.db;';
    if (specifier.endsWith('/accountSections')) source = 'export const readAccountSections = async (snapshot) => ({ combined: snapshot.data() });';
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    if (!context.parentURL?.includes('/node_modules/') && specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) specifier += '.js';
    return nextResolve(specifier, context);
  },
});
const { POST } = await import('../app/api/receptionist/runtime/route.js');
hooks.deregister();

function request(id, { to = '+17742316164', from = '+15085550123', validSignature = true, type = 'call.initiated' } = {}) {
  const body = JSON.stringify({ data: { event_type: type, payload: { call_control_id: id, direction: 'incoming', from, to } } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(null, Buffer.from(`${timestamp}|${body}`), privateKey).toString('base64');
  return new Request('https://client.example/api/receptionist/runtime', { method: 'POST', body, headers: {
    'telnyx-timestamp': timestamp, 'telnyx-signature-ed25519': validSignature ? signature : 'invalid',
  } });
}

test('signed runtime admits demo without an account, blocks cross-number retries and admits a different caller', async () => {
  let response = await POST(request('bad-signature', { validSignature: false }));
  assert.equal(response.status, 401);
  assert.equal(db.rows.size, 0);
  response = await POST(request('first-demo'));
  const demo = await response.json();
  assert.equal(response.status, 200);
  assert.equal(demo.demo, true);
  assert.equal(demo.callAdmission.allowed, true);
  assert.equal(demo.intakeUrl, undefined);
  assert.equal(afterTasks.length, 1);
  assert.equal((await POST(request('first-demo'))).status, 200);
  assert.equal([...db.rows].filter(([key]) => key.includes('EventOutbox')).length, 1);

  await db.collection('accounts').doc('regular-business').set({
    receptionistPhoneNormalized: '+15085550999', status: 'active', businessSetupComplete: true,
    businessName: 'Regular Business', ownerName: 'Test Owner', services: { painting: 'Painting' }, connectionKey: 'test-intake-key',
  });
  response = await POST(request('repeat-regular', { to: '+15085550999' }));
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('Retry-After')) > 890);
  assert.equal((await response.json()).code, 'CALLER_COOLDOWN');
  response = await POST(request('fresh-regular', { to: '+15085550999', from: '+15085550777' }));
  const regular = await response.json();
  assert.equal(response.status, 200);
  assert.equal(regular.callAdmission.allowed, true);
  assert.equal(regular.profile.businessName, 'Regular Business');
  assert.ok(regular.intakeUrl.includes('/api/intake'));
  assert.equal([...db.rows].filter(([key]) => key.includes('EventOutbox')).length, 2);
});

test('unknown destinations and later events cannot acquire admission', async () => {
  assert.equal((await POST(request('unknown', { to: '+15555550000' }))).status, 404);
  assert.equal((await POST(request('answered', { type: 'call.answered' }))).status, 400);
});
