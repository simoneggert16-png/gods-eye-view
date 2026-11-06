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
    const res = await fetch('/api/pin/status', { credentials: 'same-origin' });
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
    credentials: 'same-origin',
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
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding:
        max(28px, env(safe-area-inset-top))
        max(24px, env(safe-area-inset-right))
        max(36px, env(safe-area-inset-bottom))
        max(24px, env(safe-area-inset-left));
      overflow: auto;
      color-scheme: dark;
      background-color: #07090c;
      background-image: radial-gradient(ellipse 88% 64% at 50% 38%, #14181f 0%, #07090c 62%);
      font-family: var(--font-sans, 'Inter', -apple-system, BlinkMacSystemFont, sans-serif);
      color: #f3f5f7;
      user-select: none;
      transition: opacity 0.4s ease;
    }
    #pin-gate-modal::before {
      content: '';
      position: absolute;
      inset: 16px;
      border: 1px solid rgba(243, 245, 247, 0.1);
      pointer-events: none;
    }
    .pin-meta {
      position: absolute;
      top: 30px;
      z-index: 1;
      display: flex;
      flex-direction: column;
      gap: 5px;
      pointer-events: none;
      animation: pinFade 0.4s ease;
    }
    .pin-meta-left { left: 32px; text-align: left; }
    .pin-meta-right { right: 32px; text-align: right; }
    .pin-meta-label,
    .pin-kicker,
    .pin-tagline,
    .pin-card h2,
    .pin-box,
    .pin-status,
    .pin-pad-btn {
      font-family: var(--font-mono, 'JetBrains Mono', 'SF Mono', monospace);
    }
    .pin-meta-label,
    .pin-kicker,
    .pin-tagline {
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.28em;
      text-transform: uppercase;
      color: #a8b0b8;
    }
    .pin-meta-value {
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #f3f5f7;
    }
    .pin-card {
      position: relative;
      z-index: 1;
      width: min(100%, 440px);
      margin: auto;
      padding: 8px 8px 0;
      text-align: center;
      animation: pinFade 0.4s ease;
    }
    @keyframes pinFade {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .pin-logo {
      display: block;
      width: 84px;
      height: auto;
      margin: 0 auto 20px;
    }
    .pin-kicker {
      margin: 0 0 14px;
      color: #c5cad0;
    }
    .pin-card h2 {
      margin: 0;
      font-size: clamp(18px, 2.2vw, 26px);
      font-weight: 500;
      letter-spacing: 0.2em;
      line-height: 1.15;
      color: #f7f8f8;
      white-space: nowrap;
    }
    .pin-title-accent {
      color: #00d4ff;
      font-weight: 400;
    }
    .pin-tagline {
      margin: 12px 0 0;
      letter-spacing: 0.34em;
      color: #c2c8ce;
    }
    .pin-rule {
      width: 36px;
      height: 1px;
      margin: 26px auto 22px;
      background: rgba(243, 245, 247, 0.42);
    }
    .pin-lead {
      max-width: 36ch;
      margin: 0 auto 30px;
      font-size: 15px;
      font-weight: 400;
      line-height: 1.55;
      letter-spacing: 0.005em;
      color: #c8ced4;
    }
    .pin-lead span {
      display: block;
      margin-bottom: 6px;
      color: #f3f5f7;
      font-weight: 500;
    }
    .pin-entry {
      width: min(100%, 336px);
      margin: 0 auto;
    }
    .pin-row {
      display: flex;
      gap: 8px;
      margin: 0 0 12px;
    }
    .pin-box {
      flex: 1 1 0;
      min-width: 0;
      width: auto;
      height: 60px;
      padding: 0;
      border: 1px solid rgba(243, 245, 247, 0.4);
      border-radius: 0;
      background: #10141a;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
      color: #f7f8f8;
      font-size: 22px;
      font-weight: 500;
      line-height: 60px;
      text-align: center;
      caret-color: #f7f8f8;
      outline: none;
      -webkit-appearance: none;
      appearance: none;
      transition: border-color 0.15s ease, background-color 0.15s ease;
    }
    .pin-box::placeholder {
      color: transparent;
      opacity: 0;
    }
    .pin-box:nth-child(3) {
      margin-right: 8px;
    }
    .pin-box:not(:placeholder-shown) {
      border-color: rgba(243, 245, 247, 0.55);
      background: rgba(255, 255, 255, 0.025);
    }
    .pin-box:focus {
      border-color: #f7f8f8;
      background: rgba(255, 255, 255, 0.035);
      box-shadow: none;
    }
    .pin-box::-ms-reveal,
    .pin-box::-ms-clear {
      display: none;
    }
    .pin-status {
      width: min(100%, 460px);
      min-height: 22px;
      margin: 2px auto 18px;
      font-size: 12px;
      font-weight: 500;
      letter-spacing: 0.01em;
      line-height: 1.45;
      text-align: center;
      color: #ff4d4d;
    }
    .pin-pad {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1px;
      background: rgba(243, 245, 247, 0.14);
      border: 1px solid rgba(243, 245, 247, 0.14);
    }
    .pin-pad-btn {
      height: 54px;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: #0c0f13;
      color: #f3f5f7;
      font-size: 18px;
      font-weight: 500;
      letter-spacing: 0.02em;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: background-color 0.12s ease, color 0.12s ease;
    }
    .pin-pad-btn[data-key="C"],
    .pin-pad-btn[data-key="DEL"] {
      color: #d5dae0;
      font-size: 13px;
      letter-spacing: 0.12em;
    }
    .pin-pad-btn:hover {
      background: #171c22;
    }
    .pin-pad-btn:focus-visible {
      outline: 1px solid #f3f5f7;
      outline-offset: -1px;
    }
    .pin-pad-btn:active {
      background: #f3f5f7;
      color: #07090c;
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
    @media (max-width: 720px), (max-height: 760px) {
      .pin-meta { display: none; }
      #pin-gate-modal::before { inset: 10px; }
    }
    @media (max-width: 420px) {
      .pin-card h2 { letter-spacing: 0.12em; }
      .pin-tagline { letter-spacing: 0.22em; }
      .pin-lead { font-size: 14px; margin-bottom: 22px; }
      .pin-box { height: 52px; font-size: 18px; line-height: 52px; }
      .pin-pad-btn { height: 48px; }
      .pin-logo { width: 68px; margin-bottom: 14px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .pin-card,
      .pin-meta { animation: none; }
    }
  `;
  document.head.appendChild(style);

  const modal = document.createElement('div');
  modal.id = 'pin-gate-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'pin-gate-title');
  modal.innerHTML = `
    <div class="pin-meta pin-meta-left" aria-hidden="true">
      <span class="pin-meta-label">Console</span>
      <span class="pin-meta-value">God's Eye</span>
    </div>
    <div class="pin-meta pin-meta-right" aria-hidden="true">
      <span class="pin-meta-label">Status</span>
      <span class="pin-meta-value">Required</span>
    </div>
    <div class="pin-card" id="pin-card-inner">
      <img class="pin-logo" src="/logo.svg" alt="" width="84" height="56" />
      <p class="pin-kicker">Security clearance</p>
      <h2 id="pin-gate-title">GOD'S EYE <span class="pin-title-accent">VIEW</span></h2>
      <p class="pin-tagline">No place left behind</p>
      <div class="pin-rule" role="presentation"></div>
      <p class="pin-lead"><span>Zugangsbeschränkung aktiv.</span> Bitte 6-stelligen Sicherheitscode eingeben, um die Konsole und Satelliten-Feeds zu starten.</p>

      <div class="pin-entry">
        <div class="pin-row" id="pin-input-row">
          <input type="password" maxlength="1" class="pin-box" inputmode="numeric" pattern="[0-9]*" aria-label="Ziffer 1" placeholder=" " autofocus>
          <input type="password" maxlength="1" class="pin-box" inputmode="numeric" pattern="[0-9]*" aria-label="Ziffer 2" placeholder=" ">
          <input type="password" maxlength="1" class="pin-box" inputmode="numeric" pattern="[0-9]*" aria-label="Ziffer 3" placeholder=" ">
          <input type="password" maxlength="1" class="pin-box" inputmode="numeric" pattern="[0-9]*" aria-label="Ziffer 4" placeholder=" ">
          <input type="password" maxlength="1" class="pin-box" inputmode="numeric" pattern="[0-9]*" aria-label="Ziffer 5" placeholder=" ">
          <input type="password" maxlength="1" class="pin-box" inputmode="numeric" pattern="[0-9]*" aria-label="Ziffer 6" placeholder=" ">
        </div>

      </div>

      <div class="pin-status" id="pin-status-msg" role="status" aria-live="polite"></div>

      <div class="pin-entry">
        <div class="pin-pad" role="group" aria-label="Ziffernblock">
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
          <button type="button" class="pin-pad-btn" data-key="DEL">DEL</button>
        </div>
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

/**
 * Trigger re-authentication modal when any protected endpoint returns 401.
 */
export function triggerAuthRequired() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gev:auth-required'));
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('gev:auth-required', () => {
    sessionStorage.removeItem(PIN_SESSION_KEY);
    showPinModal();
  });
}


