const resultBox = document.getElementById('resultBox');
const drawButton = document.getElementById('drawButton');
const prizeDisplay = document.getElementById('prizeDisplay');
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
  resultBox.innerHTML = message;
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
      body: JSON.stringify({}),
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
      drawButton.disabled = true;
      setResult(data.error || '抽選に失敗しました。', true);
      return;
    }

    const winner = data.winner;
    const resultText = `<strong>${escapeHtml(winner.prizeName)}</strong>`;

    stopSpinAnimation(winner.prizeName);
    drawButton.disabled = true;
    setResult(resultText, false);
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

async function loadAdminData() {
  const adminPassword = adminPasswordInput.value.trim();
  if (!adminPassword) {
    alert('管理者パスワードを入力してください');
    return;
  }

  try {
    const response = await fetch(`/api/admin/stats?adminKey=${encodeURIComponent(adminPassword)}`);
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

    exportLink.href = `/api/admin/export?adminKey=${encodeURIComponent(adminPassword)}`;

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

loginButton?.addEventListener('click', loadAdminData);
adminPasswordInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    loadAdminData();
  }
});

document.getElementById('resetButton')?.addEventListener('click', async () => {
  const password = adminPasswordInput.value.trim();
  if (!password) {
    alert('パスワードが必要です');
    return;
  }

  const confirmed = window.confirm('イベントをリセットしますか？');
  if (!confirmed) {
    return;
  }

  const response = await fetch(`/api/admin/reset?adminKey=${encodeURIComponent(password)}`, { method: 'POST' });
  const data = await response.json();
  if (response.ok && data.ok) {
    alert('イベントをリセットしました。');
  drawButton.disabled = false;
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
  const password = adminPasswordInput.value.trim();
  if (!password) {
    alert('パスワードが必要です');
    return;
  }

  const confirmed = window.confirm('抽選を締め切りますか？');
  if (!confirmed) {
    return;
  }

  const response = await fetch(`/api/admin/close?adminKey=${encodeURIComponent(password)}`, { method: 'POST' });
  const data = await response.json();
  if (response.ok && data.ok) {
    alert('抽選を締め切りました。');
    loadAdminData();
  } else {
    alert(data.error || '締め切りに失敗しました');
  }
});
