const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createLotteryServer, parseCsv } = require('../app/server');

async function createTestApp() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lottery-test-'));
  await fs.writeFile(path.join(directory, 'index.html'), '<h1>Lottery</h1>');
  const server = createLotteryServer({
    root: directory,
    stateFile: path.join(directory, 'state.json'),
    adminKey: 'admin-secret',
    codePepper: 'pepper-secret',
    randomInt: () => 0,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    baseUrl,
    directory,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  return { response, body: await response.json() };
}

test('CSV parser supports quoted commas and escaped quotes', () => {
  assert.deepEqual(parseCsv('code,name\r\nA1,"Ishida, Maaya"\r\nA2,"A ""quoted"" name"\r\n'), [
    ['code', 'name'],
    ['A1', 'Ishida, Maaya'],
    ['A2', 'A "quoted" name'],
  ]);
});

test('admin imports configuration and participant can draw only once', async () => {
  const app = await createTestApp();
  try {
    const participants = await requestJson(`${app.baseUrl}/api/admin/participants/import?adminKey=admin-secret`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: 'code,name\nCODE-1,Alice\nCODE-2,Bob\n',
    });
    assert.equal(participants.response.status, 200);
    assert.equal(participants.body.imported, 2);

    const prizes = await requestJson(`${app.baseUrl}/api/admin/prizes/import?adminKey=admin-secret`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: 'prizeName,quantity\nFirst Prize,1\n',
    });
    assert.equal(prizes.response.status, 200);

    const firstDraw = await requestJson(`${app.baseUrl}/api/draw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantCode: 'CODE-1' }),
    });
    assert.equal(firstDraw.response.status, 200);
    assert.equal(firstDraw.body.winner.prizeName, 'First Prize');
    assert.equal(firstDraw.body.winner.isHit, true);

    const duplicateDraw = await requestJson(`${app.baseUrl}/api/draw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantCode: 'CODE-1' }),
    });
    assert.equal(duplicateDraw.response.status, 409);

    const secondDraw = await requestJson(`${app.baseUrl}/api/draw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantCode: 'CODE-2' }),
    });
    assert.equal(secondDraw.response.status, 200);
    assert.equal(secondDraw.body.winner.prizeName, 'ざんねん');
    assert.equal(secondDraw.body.winner.isHit, false);
  } finally {
    await app.close();
  }
});

test('admin authentication, close, reset, and CSV formula neutralization work', async () => {
  const app = await createTestApp();
  try {
    const unauthorized = await fetch(`${app.baseUrl}/api/admin/stats?adminKey=wrong`);
    assert.equal(unauthorized.status, 401);

    await fetch(`${app.baseUrl}/api/admin/participants/import?adminKey=admin-secret`, {
      method: 'POST',
      body: 'code,name\nCODE-1,=cmd\n',
    });
    await fetch(`${app.baseUrl}/api/admin/prizes/import?adminKey=admin-secret`, {
      method: 'POST',
      body: 'prizeName,quantity\n+Prize,1\n',
    });
    await fetch(`${app.baseUrl}/api/draw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantCode: 'CODE-1' }),
    });

    const exported = await fetch(`${app.baseUrl}/api/admin/export?adminKey=admin-secret`);
    const csv = await exported.text();
    assert.match(csv, /"'=cmd"/);
    assert.match(csv, /"'\+Prize"/);

    const closed = await requestJson(`${app.baseUrl}/api/admin/close?adminKey=admin-secret`, { method: 'POST' });
    assert.equal(closed.body.ok, true);
    const reset = await requestJson(`${app.baseUrl}/api/admin/reset?adminKey=admin-secret`, { method: 'POST' });
    assert.equal(reset.body.ok, true);
    const stats = await requestJson(`${app.baseUrl}/api/admin/stats?adminKey=admin-secret`);
    assert.equal(stats.body.state.status, 'open');
    assert.equal(stats.body.state.drawnCount, 0);
    assert.equal(stats.body.state.remainingHits, 1);
  } finally {
    await app.close();
  }
});

test('static files and health endpoint are served', async () => {
  const app = await createTestApp();
  try {
    const health = await requestJson(`${app.baseUrl}/health`);
    assert.deepEqual(health.body, { ok: true });
    const page = await fetch(`${app.baseUrl}/`);
    assert.equal(page.status, 200);
    assert.equal(await page.text(), '<h1>Lottery</h1>');
  } finally {
    await app.close();
  }
});
