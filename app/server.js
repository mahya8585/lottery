const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_STATE = Object.freeze({
  version: 1,
  status: 'open',
  participants: [],
  prizes: [],
  winners: [],
});

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (character !== '\r') {
      field += character;
    }
  }

  if (quoted) {
    throw new Error('CSVの引用符が閉じられていません。');
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((values) => values.some((value) => value.trim() !== ''));
}

function parseParticipantsCsv(text, hashCode) {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  if (rows.length < 2 || rows[0][0]?.trim() !== 'code' || rows[0][1]?.trim() !== 'name') {
    throw new Error('参加者CSVのヘッダーは code,name にしてください。');
  }

  const participants = rows.slice(1).map((row, index) => {
    const code = row[0]?.trim();
    const name = row[1]?.trim();
    if (!code || !name || code.length > 128 || name.length > 200) {
      throw new Error(`参加者CSVの${index + 2}行目が不正です。`);
    }
    return { codeHash: hashCode(code), name, draw: null };
  });

  if (!participants.length) {
    throw new Error('参加者を1件以上登録してください。');
  }
  if (new Set(participants.map((participant) => participant.codeHash)).size !== participants.length) {
    throw new Error('参加者コードが重複しています。');
  }
  return participants;
}

function parsePrizesCsv(text) {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  if (rows.length < 2 || rows[0][0]?.trim() !== 'prizeName' || rows[0][1]?.trim() !== 'quantity') {
    throw new Error('賞品CSVのヘッダーは prizeName,quantity にしてください。');
  }

  const prizes = rows.slice(1).map((row, index) => {
    const name = row[0]?.trim();
    const quantityText = row[1]?.trim();
    const quantity = Number(quantityText);
    if (!name || name.length > 200 || !/^\d+$/.test(quantityText || '') || quantity < 1 || quantity > 100000) {
      throw new Error(`賞品CSVの${index + 2}行目が不正です。`);
    }
    return { name, quantity, remaining: quantity };
  });

  if (!prizes.length) {
    throw new Error('賞品を1件以上登録してください。');
  }
  if (new Set(prizes.map((prize) => prize.name)).size !== prizes.length) {
    throw new Error('賞品名が重複しています。');
  }
  return prizes;
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function createLotteryServer(options = {}) {
  const root = path.resolve(options.root || process.env.SITE_ROOT || '/home/site/wwwroot');
  const stateFile = path.resolve(options.stateFile || process.env.DATA_FILE || '/home/data/lottery-state.json');
  const adminKey = options.adminKey ?? process.env.ADMIN_KEY ?? '';
  const codePepper = options.codePepper ?? process.env.CODE_PEPPER ?? '';
  const randomInt = options.randomInt || crypto.randomInt;
  let mutationQueue = Promise.resolve();

  function hashCode(code) {
    return crypto.createHmac('sha256', codePepper).update(code).digest('hex');
  }

  async function loadState() {
    try {
      const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
      if (state.version !== 1 || !Array.isArray(state.participants) || !Array.isArray(state.prizes)
          || !Array.isArray(state.winners)) {
        throw new Error('状態ファイルの形式が不正です。');
      }
      return state;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return cloneDefaultState();
      }
      throw error;
    }
  }

  async function saveState(state) {
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    const temporaryFile = `${stateFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryFile, stateFile);
  }

  function mutate(mutator) {
    const operation = mutationQueue.then(async () => {
      const state = await loadState();
      const result = await mutator(state);
      await saveState(state);
      return result;
    });
    mutationQueue = operation.catch(() => {});
    return operation;
  }

  function writeJson(response, statusCode, body) {
    response.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(JSON.stringify(body));
  }

  function writeApiError(response, statusCode, message) {
    writeJson(response, statusCode, { ok: false, error: message });
  }

  function isAdminRequest(url) {
    if (!adminKey) {
      return false;
    }
    const supplied = url.searchParams.get('adminKey') || '';
    const expectedBuffer = Buffer.from(adminKey);
    const suppliedBuffer = Buffer.from(supplied);
    return expectedBuffer.length === suppliedBuffer.length
      && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
  }

  async function readBody(request) {
    const chunks = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > MAX_BODY_BYTES) {
        const error = new Error('リクエストが大きすぎます。');
        error.statusCode = 413;
        throw error;
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  async function draw(request, response) {
    if (!codePepper) {
      writeApiError(response, 503, '抽選サービスが設定されていません。');
      return;
    }

    let input;
    try {
      input = JSON.parse(await readBody(request) || '{}');
    } catch (error) {
      writeApiError(response, error.statusCode || 400, '参加者コードを確認してください。');
      return;
    }
    const participantCode = typeof input.participantCode === 'string' ? input.participantCode.trim() : '';
    if (!participantCode || participantCode.length > 128) {
      writeApiError(response, 400, '参加者コードを入力してください。');
      return;
    }

    try {
      const winner = await mutate((state) => {
        if (state.status !== 'open') {
          const error = new Error('抽選は締め切られています。');
          error.statusCode = 409;
          throw error;
        }
        if (!state.participants.length || !state.prizes.length) {
          const error = new Error('抽選はまだ準備されていません。');
          error.statusCode = 409;
          throw error;
        }

        const participant = state.participants.find((entry) => entry.codeHash === hashCode(participantCode));
        if (!participant) {
          const error = new Error('参加者コードが正しくありません。');
          error.statusCode = 403;
          throw error;
        }
        if (participant.draw) {
          const error = new Error('この参加者コードは使用済みです。');
          error.statusCode = 409;
          throw error;
        }

        const remainingParticipants = state.participants.filter((entry) => !entry.draw).length;
        const remainingPrizes = state.prizes.reduce((sum, prize) => sum + prize.remaining, 0);
        if (remainingPrizes > remainingParticipants) {
          const error = new Error('賞品数が残り参加者数を超えています。');
          error.statusCode = 409;
          throw error;
        }

        let selectedPrize = null;
        const drawValue = randomInt(remainingParticipants);
        if (drawValue < remainingPrizes) {
          let prizeValue = randomInt(remainingPrizes);
          selectedPrize = state.prizes.find((prize) => {
            prizeValue -= prize.remaining;
            return prizeValue < 0;
          });
          selectedPrize.remaining -= 1;
        }

        const result = {
          drawNumber: state.winners.length + 1,
          name: participant.name,
          prizeName: selectedPrize?.name || 'ざんねん',
          isHit: Boolean(selectedPrize),
          drawnAt: new Date().toISOString(),
        };
        participant.draw = result;
        state.winners.push(result);
        return result;
      });
      writeJson(response, 200, { ok: true, winner });
    } catch (error) {
      if (error.statusCode) {
        writeApiError(response, error.statusCode, error.message);
        return;
      }
      console.error(error);
      writeApiError(response, 500, '抽選処理に失敗しました。');
    }
  }

  async function adminApi(request, response, url) {
    if (!adminKey) {
      writeApiError(response, 503, '管理APIが設定されていません。');
      return;
    }
    if (!isAdminRequest(url)) {
      writeApiError(response, 401, '認証に失敗しました。');
      return;
    }

    const pathname = url.pathname;
    if (request.method === 'GET' && pathname === '/api/admin/stats') {
      const state = await loadState();
      const totalHits = state.prizes.reduce((sum, prize) => sum + prize.quantity, 0);
      const remainingHits = state.prizes.reduce((sum, prize) => sum + prize.remaining, 0);
      writeJson(response, 200, {
        ok: true,
        state: {
          status: state.status,
          participantCount: state.participants.length,
          drawnCount: state.winners.length,
          totalHits,
          maxHits: totalHits,
          remainingHits,
          prizes: state.prizes,
          winners: state.winners,
        },
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/admin/export') {
      const state = await loadState();
      const rows = [
        ['drawNumber', 'name', 'prizeName', 'isHit', 'drawnAt'],
        ...state.winners.map((winner) => [
          winner.drawNumber,
          winner.name,
          winner.prizeName,
          winner.isHit,
          winner.drawnAt,
        ]),
      ];
      const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
      response.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="lottery-results.csv"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(csv);
      return;
    }

    if (request.method === 'POST' && pathname === '/api/admin/participants/import') {
      try {
        const participants = parseParticipantsCsv(await readBody(request), hashCode);
        await mutate((state) => {
          if (state.winners.length) {
            const error = new Error('抽選開始後は参加者を変更できません。');
            error.statusCode = 409;
            throw error;
          }
          const totalPrizes = state.prizes.reduce((sum, prize) => sum + prize.quantity, 0);
          if (totalPrizes > participants.length) {
            const error = new Error('参加者数は賞品総数以上にしてください。');
            error.statusCode = 400;
            throw error;
          }
          state.participants = participants;
        });
        writeJson(response, 200, { ok: true, imported: participants.length });
      } catch (error) {
        writeApiError(response, error.statusCode || 400, error.message);
      }
      return;
    }

    if (request.method === 'POST' && pathname === '/api/admin/prizes/import') {
      try {
        const prizes = parsePrizesCsv(await readBody(request));
        await mutate((state) => {
          if (state.winners.length) {
            const error = new Error('抽選開始後は賞品を変更できません。');
            error.statusCode = 409;
            throw error;
          }
          if (state.participants.length && prizes.reduce((sum, prize) => sum + prize.quantity, 0) > state.participants.length) {
            const error = new Error('賞品総数は参加者数以下にしてください。');
            error.statusCode = 400;
            throw error;
          }
          state.prizes = prizes;
        });
        writeJson(response, 200, { ok: true, imported: prizes.length });
      } catch (error) {
        writeApiError(response, error.statusCode || 400, error.message);
      }
      return;
    }

    if (request.method === 'POST' && pathname === '/api/admin/reset') {
      await mutate((state) => {
        state.status = 'open';
        state.winners = [];
        state.participants.forEach((participant) => {
          participant.draw = null;
        });
        state.prizes.forEach((prize) => {
          prize.remaining = prize.quantity;
        });
      });
      writeJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/admin/close') {
      await mutate((state) => {
        state.status = 'closed';
      });
      writeJson(response, 200, { ok: true });
      return;
    }

    writeApiError(response, 404, 'APIが見つかりません。');
  }

  async function serveStatic(request, response, url) {
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch (error) {
      response.writeHead(400);
      response.end('Bad Request');
      return;
    }

    const relativePath = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const candidatePath = path.resolve(root, `.${relativePath}`);
    if (candidatePath !== root && !candidatePath.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    try {
      const stats = await fs.stat(candidatePath);
      const filePath = stats.isDirectory() ? path.join(candidatePath, 'index.html') : candidatePath;
      const content = await fs.readFile(filePath);
      response.writeHead(200, {
        'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin',
      });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        response.writeHead(404);
        response.end('Not Found');
        return;
      }
      throw error;
    }
  }

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/health') {
        writeJson(response, 200, { ok: true });
      } else if (request.method === 'POST' && url.pathname === '/api/draw') {
        await draw(request, response);
      } else if (url.pathname.startsWith('/api/admin/')) {
        await adminApi(request, response, url);
      } else if (url.pathname.startsWith('/api/')) {
        writeApiError(response, 404, 'APIが見つかりません。');
      } else if (request.method === 'GET' || request.method === 'HEAD') {
        await serveStatic(request, response, url);
      } else {
        response.writeHead(405, { Allow: 'GET, HEAD' });
        response.end('Method Not Allowed');
      }
    } catch (error) {
      console.error(error);
      if (!response.headersSent) {
        writeApiError(response, 500, 'サーバーエラーが発生しました。');
      } else {
        response.destroy();
      }
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  createLotteryServer().listen(port, () => {
    console.log(`Lottery server listening on port ${port}`);
  });
}

module.exports = {
  createLotteryServer,
  parseCsv,
  parseParticipantsCsv,
  parsePrizesCsv,
};
