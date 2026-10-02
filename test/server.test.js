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

async function adminLogin(baseUrl, password = 'admin-secret') {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const setCookie = response.headers.get('set-cookie') || '';
  return { response, setCookie, cookie: setCookie.split(';')[0] };
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
    const { cookie } = await adminLogin(app.baseUrl);
    const participants = await requestJson(`${app.baseUrl}/api/admin/participants/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', Cookie: cookie },
      body: 'code,name\nCODE-1,Alice\nCODE-2,Bob\n',
    });
    assert.equal(participants.response.status, 200);
    assert.equal(participants.body.imported, 2);

    const prizes = await requestJson(`${app.baseUrl}/api/admin/prizes/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', Cookie: cookie },
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
    const unauthorized = await fetch(`${app.baseUrl}/api/admin/stats`);
    assert.equal(unauthorized.status, 401);
    const wrongLogin = await adminLogin(app.baseUrl, 'wrong');
    assert.equal(wrongLogin.response.status, 401);
    assert.equal(wrongLogin.setCookie, '');

    const { cookie } = await adminLogin(app.baseUrl);
    const headers = { Cookie: cookie };
    await fetch(`${app.baseUrl}/api/admin/participants/import`, {
      method: 'POST',
      headers,
      body: 'code,name\nCODE-1,=cmd\n',
    });
    await fetch(`${app.baseUrl}/api/admin/prizes/import`, {
      method: 'POST',
      headers,
      body: 'prizeName,quantity\n+Prize,1\n',
    });
    await fetch(`${app.baseUrl}/api/draw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantCode: 'CODE-1' }),
    });

    const exported = await fetch(`${app.baseUrl}/api/admin/export`, { headers });
    const csv = await exported.text();
    assert.match(csv, /"'=cmd"/);
    assert.match(csv, /"'\+Prize"/);

    const closed = await requestJson(`${app.baseUrl}/api/admin/close`, { method: 'POST', headers });
    assert.equal(closed.body.ok, true);
    const reset = await requestJson(`${app.baseUrl}/api/admin/reset`, { method: 'POST', headers });
    assert.equal(reset.body.ok, true);
    const stats = await requestJson(`${app.baseUrl}/api/admin/stats`, { headers });
    assert.equal(stats.body.state.status, 'open');
    assert.equal(stats.body.state.drawnCount, 0);
    assert.equal(stats.body.state.remainingHits, 1);
  } finally {
    await app.close();
  }
});

test('admin password is only accepted via POST login and issues a secure session cookie', async () => {
  const app = await createTestApp();
  try {
    const queryKey = await fetch(`${app.baseUrl}/api/admin/stats?adminKey=admin-secret`);
    assert.equal(queryKey.status, 401);

    const login = await adminLogin(app.baseUrl);
    assert.equal(login.response.status, 200);
    assert.match(login.setCookie, /^lottery_admin_session=[A-Za-z0-9_-]{43};/);
    assert.match(login.setCookie, /; HttpOnly/);
    assert.match(login.setCookie, /; Secure/);
    assert.match(login.setCookie, /; SameSite=Strict/);
    assert.match(login.setCookie, /; Max-Age=1800/);

    const forged = await fetch(`${app.baseUrl}/api/admin/stats`, {
      headers: { Cookie: 'lottery_admin_session=forged' },
    });
    assert.equal(forged.status, 401);

    const stats = await fetch(`${app.baseUrl}/api/admin/stats`, { headers: { Cookie: login.cookie } });
    assert.equal(stats.status, 200);

    const logout = await fetch(`${app.baseUrl}/api/admin/logout`, {
      method: 'POST',
      headers: { Cookie: login.cookie },
    });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    const afterLogout = await fetch(`${app.baseUrl}/api/admin/stats`, { headers: { Cookie: login.cookie } });
    assert.equal(afterLogout.status, 401);
  } finally {
    await app.close();
  }
});

test('admin sessions expire', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lottery-test-'));
  const server = createLotteryServer({
    root: directory,
    stateFile: path.join(directory, 'state.json'),
    adminKey: 'admin-secret',
    codePepper: 'pepper-secret',
    adminSessionTtlMs: 50,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const { cookie } = await adminLogin(baseUrl);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const expired = await fetch(`${baseUrl}/api/admin/stats`, { headers: { Cookie: cookie } });
    assert.equal(expired.status, 401);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await fs.rm(directory, { recursive: true, force: true });
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
