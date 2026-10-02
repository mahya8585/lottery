const resultBox = document.getElementById('resultBox');
const drawButton = document.getElementById('drawButton');
const prizeDisplay = document.getElementById('prizeDisplay');
const participantCodeInput = document.getElementById('participantCode');
const SPIN_VALUES = ['当たり', 'ざんねん', '大当たり', '当たり', 'ざんねん', '当たり'];

const adminPasswordInput = document.getElementById('adminPassword');
const loginButton = document.getElementById('loginButton');
const adminDashboard = document.getElementById('adminDashboard');
const winnerTableBody = document.getElementById('winnerTableBody');
const exportLink = document.getElementById('exportLink');

let spinTimer = null;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setResult(message, isError = false) {
  if (!resultBox) {
    return;
  }

  resultBox.classList.remove('hidden');
  resultBox.classList.toggle('error', isError);
  resultBox.textContent = message;
}

function startSpinAnimation() {
  if (!prizeDisplay) {
    return;
  }

  let frame = 0;
  if (spinTimer) {
    clearInterval(spinTimer);
  }

  spinTimer = window.setInterval(() => {
    prizeDisplay.textContent = SPIN_VALUES[frame % SPIN_VALUES.length];
    frame += 1;
  }, 120);
}

function stopSpinAnimation(finalText) {
  if (spinTimer) {
    clearInterval(spinTimer);
    spinTimer = null;
  }

  const machine = document.querySelector('.machine');
  if (machine) {
    machine.classList.remove('is-spinning');
  }

  if (prizeDisplay) {
    window.setTimeout(() => {
      prizeDisplay.textContent = finalText;
      prizeDisplay.style.transform = 'scale(1.08)';
      requestAnimationFrame(() => {
        prizeDisplay.style.transform = 'scale(1)';
      });
    }, 260);
  }
}

async function drawPrize() {
  if (drawButton?.disabled) {
    return;
  }

  const participantCode = participantCodeInput?.value.trim();
  if (!participantCode) {
    setResult('参加者コードを入力してください。', true);
    participantCodeInput?.focus();
    return;
  }

  const machine = document.querySelector('.machine');
  if (prizeDisplay) {
    prizeDisplay.textContent = '…';
    prizeDisplay.style.transform = 'scale(1.1)';
  }
  if (machine) {
    machine.classList.add('is-spinning');
  }
  startSpinAnimation();

  try {
    const response = await fetch('/api/draw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantCode }),
    });

    const data = await response.json();
    if (!response.ok) {
      if (prizeDisplay) {
        prizeDisplay.textContent = '?';
        prizeDisplay.style.transform = 'scale(1)';
      }
      if (machine) {
        machine.classList.remove('is-spinning');
      }
      if (spinTimer) {
        clearInterval(spinTimer);
        spinTimer = null;
      }
      setResult(data.error || '抽選に失敗しました。', true);
      return;
    }

    const winner = data.winner;
    stopSpinAnimation(winner.prizeName);
    drawButton.disabled = true;
    participantCodeInput.disabled = true;
    setResult(winner.prizeName, false);
  } catch (error) {
    if (prizeDisplay) {
      prizeDisplay.textContent = '?';
      prizeDisplay.style.transform = 'scale(1)';
    }
    if (machine) {
      machine.classList.remove('is-spinning');
    }
    if (spinTimer) {
      clearInterval(spinTimer);
      spinTimer = null;
    }
    setResult('通信エラーが発生しました。時間をおいて再度お試しください。', true);
  }
}

drawButton?.addEventListener('click', drawPrize);

async function loginAdmin() {
  const adminPassword = adminPasswordInput.value.trim();
  if (!adminPassword) {
    alert('管理者パスワードを入力してください');
    return;
  }

  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password: adminPassword }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      alert(data.error || '認証に失敗しました');
      return;
    }
    adminPasswordInput.value = '';
    await loadAdminData();
  } catch (error) {
    alert('認証に失敗しました');
  }
}

function handleAdminUnauthorized(response) {
  if (response.status !== 401) {
    return false;
  }
  adminDashboard?.classList.add('hidden');
  alert('セッションの有効期限が切れました。再度ログインしてください。');
  adminPasswordInput?.focus();
  return true;
}

async function loadAdminData() {
  try {
    const response = await fetch('/api/admin/stats', { credentials: 'same-origin' });
    if (handleAdminUnauthorized(response)) {
      return;
    }
    const data = await response.json();

    if (!response.ok || !data.ok) {
      alert(data.error || '認証に失敗しました');
      return;
    }

    const state = data.state;
    adminDashboard.classList.remove('hidden');
    const maxHits = Number(state.maxHits ?? state.totalHits ?? 60);
    const remainingHits = Number(state.remainingHits ?? maxHits);
    document.getElementById('adminStatus').textContent = state.status;
    document.getElementById('adminWins').textContent = String(state.winners.filter((winner) => winner.isHit).length);
    document.getElementById('adminRemaining').textContent = `${remainingHits} / ${maxHits}`;
    document.getElementById('adminParticipants').textContent = String(state.participantCount ?? 0);
    document.getElementById('adminDrawn').textContent = String(state.drawnCount ?? state.winners.length);

    exportLink.href = '/api/admin/export';

    winnerTableBody.innerHTML = state.winners.length
      ? state.winners.map((winner) => `
        <tr>
          <td>${winner.drawNumber}</td>
          <td>${escapeHtml(winner.name)}</td>
          <td>${escapeHtml(winner.prizeName ?? (winner.isHit ? '当たり' : 'ざんねん'))}</td>
          <td>${winner.isHit ? '当たり' : 'ざんねん'}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="4">当選結果はまだありません</td></tr>';
  } catch (error) {
    alert('管理者データの取得に失敗しました。');
  }
}

loginButton?.addEventListener('click', loginAdmin);
adminPasswordInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    loginAdmin();
  }
});

async function importCsv(fileInputId, endpoint, label) {
  const file = document.getElementById(fileInputId)?.files[0];
  if (!file) {
    alert(`${label}CSVを指定してください`);
    return;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv; charset=utf-8' },
      credentials: 'same-origin',
      body: await file.text(),
    });
    if (handleAdminUnauthorized(response)) {
      return;
    }
    const data = await response.json();
    if (!response.ok || !data.ok) {
      alert(data.error || `${label}の登録に失敗しました`);
      return;
    }
    alert(`${label}を${data.imported}件登録しました`);
    loadAdminData();
  } catch (error) {
    alert(`${label}の登録に失敗しました`);
  }
}

document.getElementById('importParticipantsButton')?.addEventListener('click', () => {
  importCsv('participantsFile', '/api/admin/participants/import', '参加者');
});

document.getElementById('importPrizesButton')?.addEventListener('click', () => {
  importCsv('prizesFile', '/api/admin/prizes/import', '賞品');
});

document.getElementById('resetButton')?.addEventListener('click', async () => {
  const confirmed = window.confirm('イベントをリセットしますか？');
  if (!confirmed) {
    return;
  }

  const response = await fetch('/api/admin/reset', { method: 'POST', credentials: 'same-origin' });
  if (handleAdminUnauthorized(response)) {
    return;
  }
  const data = await response.json();
  if (response.ok && data.ok) {
    alert('イベントをリセットしました。');
    if (drawButton) {
      drawButton.disabled = false;
    }
    if (participantCodeInput) {
      participantCodeInput.disabled = false;
    }
    setResult('', false);
    if (prizeDisplay) {
      prizeDisplay.textContent = '?';
    }
    loadAdminData();
  } else {
    alert(data.error || 'リセットに失敗しました');
  }
});

document.getElementById('closeButton')?.addEventListener('click', async () => {
  const confirmed = window.confirm('抽選を締め切りますか？');
  if (!confirmed) {
    return;
  }

  const response = await fetch('/api/admin/close', { method: 'POST', credentials: 'same-origin' });
  if (handleAdminUnauthorized(response)) {
    return;
  }
  const data = await response.json();
  if (response.ok && data.ok) {
    alert('抽選を締め切りました。');
    loadAdminData();
  } else {
    alert(data.error || '締め切りに失敗しました');
  }
});
