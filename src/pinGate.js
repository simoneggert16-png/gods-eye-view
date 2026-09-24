/**
 * PIN Gatekeeper for God's Eye View.
 *
 * When GEV_ACCESS_PIN is configured on the server, visitors must provide the
 * 6-digit passcode before the 3D globe and AI voice models initialize.
 * Prevents unauthorized users from draining Gemini / Ollama / Google 3D quotas.
 */

const PIN_SESSION_KEY = 'gev_pin_unlocked';

export async function checkPinRequirement() {
  try {
    const res = await fetch('/api/pin/status');
    if (!res.ok) return { required: false, authenticated: true };
    return await res.json();
  } catch {
    return { required: false, authenticated: true };
  }
}

export async function verifyPin(pin) {
  const res = await fetch('/api/pin/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'Server error' }));
  return { ok: res.ok && data.ok, error: data.error };
}

export function showPinModal(onSuccess) {
  if (document.getElementById('pin-gate-modal')) return;

  const style = document.createElement('style');
  style.id = 'pin-gate-style';
  style.textContent = `
    #pin-gate-modal {
      position: fixed;
      inset: 0;
      z-index: 999999;
      background: rgba(10, 10, 15, 0.88);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      font-family: var(--font-sans, -apple-system, sans-serif);
      color: #e8eaed;
      transition: opacity 0.4s ease;
    }
    .pin-card {
      background: rgba(18, 20, 32, 0.92);
      border: 1px solid rgba(0, 212, 255, 0.3);
      box-shadow: 0 0 40px rgba(0, 212, 255, 0.15), 0 20px 50px rgba(0, 0, 0, 0.8);
      border-radius: 18px;
      padding: 36px 28px;
      max-width: 420px;
      width: 100%;
      text-align: center;
      animation: pinCardEnter 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes pinCardEnter {
      from { opacity: 0; transform: scale(0.94) translateY(10px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    .pin-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 999px;
      background: rgba(0, 212, 255, 0.12);
      border: 1px solid rgba(0, 212, 255, 0.4);
      color: #00d4ff;
      font-family: var(--font-mono, monospace);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      margin-bottom: 18px;
      text-transform: uppercase;
    }
    .pin-card h2 {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }
    .pin-card p {
      font-size: 13px;
      color: rgba(232, 234, 237, 0.6);
      line-height: 1.45;
      margin-bottom: 24px;
    }
    .pin-row {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-bottom: 16px;
    }
    .pin-box {
      width: 44px;
      height: 54px;
      background: rgba(8, 10, 18, 0.8);
      border: 2px solid rgba(255, 255, 255, 0.12);
      border-radius: 10px;
      font-family: var(--font-mono, monospace);
      font-size: 24px;
      font-weight: 700;
      color: #00d4ff;
      text-align: center;
      outline: none;
      transition: all 0.2s ease;
    }
    .pin-box:focus {
      border-color: #00d4ff;
      box-shadow: 0 0 16px rgba(0, 212, 255, 0.5);
      background: rgba(12, 16, 28, 0.95);
    }
    .pin-status {
      min-height: 20px;
      font-size: 12px;
      color: #ff4d4d;
      font-family: var(--font-mono, monospace);
      margin-bottom: 20px;
    }
    .pin-pad {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      max-width: 270px;
      margin: 0 auto;
    }
    .pin-pad-btn {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      color: #e8eaed;
      font-family: var(--font-mono, monospace);
      font-size: 20px;
      font-weight: 600;
      padding: 14px;
      cursor: pointer;
      user-select: none;
      transition: all 0.15s ease;
    }
    .pin-pad-btn:hover {
      background: rgba(0, 212, 255, 0.12);
      border-color: rgba(0, 212, 255, 0.3);
    }
    .pin-pad-btn:active {
      transform: scale(0.95);
      background: #00d4ff;
      color: #0a0a0f;
    }
    .pin-shake {
      animation: pinShake 0.4s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
    }
    @keyframes pinShake {
      10%, 90% { transform: translate3d(-2px, 0, 0); }
      20%, 80% { transform: translate3d(3px, 0, 0); }
      30%, 50%, 70% { transform: translate3d(-5px, 0, 0); }
      40%, 60% { transform: translate3d(5px, 0, 0); }
    }
  `;
  document.head.appendChild(style);

  const modal = document.createElement('div');
  modal.id = 'pin-gate-modal';
  modal.innerHTML = `
    <div class="pin-card" id="pin-card-inner">
      <div class="pin-badge">
        <span>🔒</span> SECURITY CLEARANCE
      </div>
      <h2>GOD'S EYE VIEW</h2>
      <p>Zugangsbeschränkung aktiv. Bitte 6-stelligen Sicherheitscode eingeben, um die Konsole und Satelliten-Feeds zu starten.</p>

      <div class="pin-row" id="pin-input-row">
        <input type="password" maxlength="1" class="pin-box" inputmode="numeric" pattern="[0-9]*" autofocus>
        <input type="password" maxlength="1" class="pin-box" inputmode="numeric" pattern="[0-9]*">
        <input type="password" maxlength="1" class="pin-box" inputmode="numeric" pattern="[0-9]*">
        <input type="password" maxlength="1" class="pin-box" inputmode="numeric" pattern="[0-9]*">
        <input type="password" maxlength="1" class="pin-box" inputmode="numeric" pattern="[0-9]*">
        <input type="password" maxlength="1" class="pin-box" inputmode="numeric" pattern="[0-9]*">
      </div>

      <div class="pin-status" id="pin-status-msg"></div>

      <div class="pin-pad">
        <button type="button" class="pin-pad-btn" data-key="1">1</button>
        <button type="button" class="pin-pad-btn" data-key="2">2</button>
        <button type="button" class="pin-pad-btn" data-key="3">3</button>
        <button type="button" class="pin-pad-btn" data-key="4">4</button>
        <button type="button" class="pin-pad-btn" data-key="5">5</button>
        <button type="button" class="pin-pad-btn" data-key="6">6</button>
        <button type="button" class="pin-pad-btn" data-key="7">7</button>
        <button type="button" class="pin-pad-btn" data-key="8">8</button>
        <button type="button" class="pin-pad-btn" data-key="9">9</button>
        <button type="button" class="pin-pad-btn" data-key="C">C</button>
        <button type="button" class="pin-pad-btn" data-key="0">0</button>
        <button type="button" class="pin-pad-btn" data-key="DEL">⌫</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const boxes = Array.from(modal.querySelectorAll('.pin-box'));
  const statusMsg = modal.querySelector('#pin-status-msg');
  const card = modal.querySelector('#pin-card-inner');

  function clearAll() {
    boxes.forEach((b) => b.value = '');
    boxes[0].focus();
  }

  async function trySubmit() {
    const pin = boxes.map((b) => b.value).join('');
    if (pin.length !== 6) return;

    statusMsg.style.color = '#00d4ff';
    statusMsg.textContent = 'VERIFIZIERE CODE...';

    const res = await verifyPin(pin);
    if (res.ok) {
      statusMsg.style.color = '#00ff88';
      statusMsg.textContent = 'ZUGANG GEWÄHRT. INITIALISIERE...';
      sessionStorage.setItem(PIN_SESSION_KEY, 'true');
      setTimeout(() => {
        modal.style.opacity = '0';
        setTimeout(() => {
          modal.remove();
          if (typeof onSuccess === 'function') onSuccess();
        }, 400);
      }, 500);
    } else {
      statusMsg.style.color = '#ff4d4d';
      statusMsg.textContent = res.error || 'UNGÜLTIGER PIN';
      card.classList.remove('pin-shake');
      void card.offsetWidth; // trigger reflow
      card.classList.add('pin-shake');
      clearAll();
    }
  }

  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      if (box.value && i < 5) boxes[i + 1].focus();
      trySubmit();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && i > 0) {
        boxes[i - 1].focus();
      }
    });
  });

  modal.querySelectorAll('.pin-pad-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      if (key === 'C') {
        clearAll();
        statusMsg.textContent = '';
      } else if (key === 'DEL') {
        for (let i = 5; i >= 0; i--) {
          if (boxes[i].value) {
            boxes[i].value = '';
            boxes[i].focus();
            break;
          }
        }
      } else {
        const next = boxes.find((b) => !b.value);
        if (next) {
          next.value = key;
          const idx = boxes.indexOf(next);
          if (idx < 5) boxes[idx + 1].focus();
          trySubmit();
        }
      }
    });
  });

  boxes[0].focus();
}

/**
 * Gatekeeper entrypoint: checks requirement and gates boot if necessary.
 */
export async function gatekeeper(bootFn) {
  const status = await checkPinRequirement();
  if (!status.required || status.authenticated) {
    return bootFn();
  }
  showPinModal(() => {
    bootFn();
  });
}
