/* GitHub funnel + multi-currency tipping + tracking consent.
   The GitHub icon never links straight to GitHub: it opens this modal, captures the
   email (required), optionally runs a tip — Razorpay for INR, PayPal Buttons for foreign
   currencies — then fetches the repo URL from the backend and redirects.
   Currency is resolved server-side; the picker lets the visitor override it. */
(function () {
  'use strict';
  const COSMO = window.COSMO || {};
  const CUR = COSMO.currencies || {};
  const modal = document.getElementById('funnel');
  const form = document.getElementById('funnel-form');
  const msg = document.getElementById('funnel-msg');
  const submit = document.getElementById('funnel-submit');
  const eyesBox = document.getElementById('funnel-eyes');
  let selectedAmt = 0;
  let modalEyes = null;

  let curCode = COSMO.currency || 'USD';
  let provider = COSMO.provider || 'razorpay';
  const hasRzp = COSMO.razorpayKeyId && !/REPLACE/i.test(COSMO.razorpayKeyId);
  const hasPaypal = !!COSMO.paypalClientId;

  function meta() { return CUR[curCode] || { symbol: '', floor: 1, presets: [] }; }
  function emailVal() { return (form.querySelector('input[name=email]').value || '').trim(); }
  function amountVal() {
    const c = parseInt(form.querySelector('input[name=custom]').value, 10);
    return c > 0 ? c : selectedAmt;
  }
  function validEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }

  function openFunnel(preset) {
    if (!modal) return;
    modal.hidden = false;
    if (!modalEyes && eyesBox && window.CosmoEyes) {
      modalEyes = new CosmoEyes(eyesBox, { scale: 0.9 });
      // Keep eyes OPEN (idle) — a heart pop conveys delight without the closed 'happy' squint.
      setTimeout(() => modalEyes.pulse('heart'), 250);
    }
    renderCurrencyUI();
    setupPaypal();
    if (preset) selectAmount(preset);
    const email = form && form.querySelector('input[name=email]');
    if (email) setTimeout(() => email.focus(), 50);
  }
  function closeFunnel() { if (modal) modal.hidden = true; }

  function selectAmount(amt) {
    selectedAmt = parseInt(amt, 10) || 0;
    document.querySelectorAll('#tip-row .tip').forEach((b) =>
      b.classList.toggle('is-sel', parseInt(b.dataset.amt, 10) === selectedAmt));
    const custom = form && form.querySelector('input[name=custom]');
    if (custom && parseInt(custom.value, 10) !== selectedAmt) custom.value = '';
  }

  // Build presets + currency <select> for the active currency.
  function renderCurrencyUI() {
    const row = document.getElementById('tip-row');
    if (!row) return;
    const custom = row.querySelector('input[name=custom]');
    row.querySelectorAll('.tip').forEach((b) => b.remove());
    const m = meta();
    (m.presets || []).forEach((amt) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tip'; b.dataset.amt = String(amt);
      b.textContent = m.symbol + amt;
      b.addEventListener('click', () => selectAmount(amt));
      row.insertBefore(b, custom);
    });
    if (custom) custom.placeholder = m.symbol + ' custom';
    const sel = document.getElementById('cur-select');
    if (sel) {
      if (!sel.dataset.built) {
        Object.keys(CUR).forEach((code) => {
          const o = document.createElement('option');
          o.value = code; o.textContent = code + ' (' + CUR[code].symbol + ')';
          sel.appendChild(o);
        });
        sel.dataset.built = '1';
        sel.addEventListener('change', () => setCurrency(sel.value));
      }
      sel.value = curCode;
    }
    selectedAmt = 0;
  }

  function setCurrency(code) {
    if (!CUR[code]) return;
    curCode = code;
    provider = (code === 'INR') ? 'razorpay' : (hasPaypal ? 'paypal' : 'razorpay');
    renderCurrencyUI();
    setupPaypal();
  }

  function setMsg(text, cls) { if (msg) { msg.textContent = text; msg.className = 'modal__msg ' + (cls || ''); } }

  async function postJSON(url, body) {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    let data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error(data.error || ('Request failed (' + r.status + ')'));
    return data;
  }

  function go(url) {
    setMsg('Opening the repo…', 'ok');
    setTimeout(() => { window.location.href = url; }, 600);
  }

  function onList() {
    setMsg("You're on the list! The repo goes public soon — we'll email you. 💛", 'ok');
    if (submit) { submit.disabled = true; submit.textContent = 'Added ✓'; }
  }

  // ---- Razorpay (INR), submit-driven ----
  function runRazorpay(order, email) {
    return new Promise((resolve, reject) => {
      const rzp = new window.Razorpay({
        key: order.key_id, order_id: order.order_id, amount: order.amount, currency: order.currency,
        name: 'Cosmo', description: 'Buy me a coffee ☕',
        prefill: { email: email }, theme: { color: '#4a9eff' },
        handler: async (resp) => {
          try {
            const v = await postJSON('api/verify_payment.php', {
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature, email: email,
            });
            resolve(v);
          } catch (err) { reject(err); }
        },
        modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
      });
      rzp.open();
    });
  }

  // ---- PayPal (foreign), button-driven ----
  function setupPaypal() {
    const mount = document.getElementById('paypal-buttons');
    if (!mount) return;
    const usePaypal = provider === 'paypal' && hasPaypal && window.paypal;
    mount.hidden = !usePaypal;
    if (usePaypal) {
      renderPaypalButtons();
      if (submit) submit.textContent = 'Continue free (no tip) →';
    } else if (submit) {
      submit.textContent = 'Continue to GitHub →';
    }
  }

  function renderPaypalButtons() {
    const mount = document.getElementById('paypal-buttons');
    if (!mount || !window.paypal || mount.dataset.rendered) return;
    mount.dataset.rendered = '1';
    window.paypal.Buttons({
      style: { layout: 'horizontal', height: 40, tagline: false },
      createOrder: async () => {
        const email = emailVal();
        if (!validEmail(email)) { setMsg('Enter your email first ☝️', 'err'); throw new Error('email required'); }
        const amt = amountVal();
        const m = meta();
        if (amt < (m.floor || 1)) { setMsg('Pick at least ' + m.symbol + (m.floor || 1) + ' ☕', 'err'); throw new Error('below floor'); }
        const consent = form.querySelector('input[name=consent]').checked ? 1 : 0;
        try { await postJSON('api/subscribe.php', { email: email, consent: consent }); } catch (_) {}
        const order = await postJSON('api/create_order.php', { amount: amt, email: email, currency: curCode });
        return order.order_id;
      },
      onApprove: async (data) => {
        try {
          const v = await postJSON('api/paypal_capture.php', { order_id: data.orderID, email: emailVal() });
          if (v.repo_url) return go(v.repo_url);
          setMsg('Thank you so much! ☕ The repo link is on its way to your inbox.', 'ok');
        } catch (err) { setMsg(err.message || 'Capture failed. Try again?', 'err'); }
      },
      onCancel: () => setMsg('Payment cancelled — you can still continue free.', ''),
      onError: () => setMsg('PayPal had a problem. Try again?', 'err'),
    }).render('#paypal-buttons');
  }

  if (form) form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = emailVal();
    const consent = form.querySelector('input[name=consent]').checked ? 1 : 0;
    if (!validEmail(email)) { setMsg('Please enter a valid email.', 'err'); return; }
    const amt = amountVal();
    selectedAmt = amt;

    submit.disabled = true; setMsg('Saving…');
    try {
      const sub = await postJSON('api/subscribe.php', { email: email, consent: consent });

      // INR tip → Razorpay, driven by this button. (PayPal tips use the PayPal button.)
      if (amt > 0 && provider === 'razorpay' && hasRzp) {
        setMsg('Opening secure checkout…');
        const order = await postJSON('api/create_order.php', { amount: amt, email: email, currency: curCode });
        const v = await runRazorpay(order, email);
        if (v.repo_url) return go(v.repo_url);
        setMsg('Thank you so much! ☕ The repo link is on its way to your inbox.', 'ok');
        return;
      }

      // No tip (or PayPal selected → tip happens via the PayPal button): continue free.
      if (sub.repo_url) return go(sub.repo_url);
      if (sub.require_payment && (hasRzp || hasPaypal)) {
        setMsg('A coffee unlocks the repo ☕ — pick an amount above.', 'err'); submit.disabled = false; return;
      }
      onList();
    } catch (err) {
      setMsg(err.message || 'Something went wrong. Try again?', 'err');
      submit.disabled = false;
    }
  });

  // Open triggers: nav GitHub button + any .js-funnel link + support-page tips.
  const ghBtn = document.getElementById('github-funnel');
  if (ghBtn) ghBtn.addEventListener('click', () => openFunnel());
  document.querySelectorAll('.js-funnel').forEach((a) =>
    a.addEventListener('click', (e) => { e.preventDefault(); openFunnel(); }));
  document.querySelectorAll('#support-tips .tip').forEach((b) =>
    b.addEventListener('click', () => openFunnel(parseInt(b.dataset.amt, 10))));
  if (modal) modal.querySelectorAll('[data-close]').forEach((x) => x.addEventListener('click', closeFunnel));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFunnel(); });

  // ---- tracking consent banner ----
  const cookie = document.getElementById('cookie');
  function cset(name, val, days) {
    const d = new Date(); d.setTime(d.getTime() + days * 864e5);
    document.cookie = name + '=' + val + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  }
  if (cookie && !/cosmo_ack=1/.test(document.cookie)) {
    cookie.hidden = false;
    const ok = document.getElementById('cookie-ok');
    const no = document.getElementById('cookie-no');
    if (ok) ok.addEventListener('click', () => { cset('cosmo_ack', '1', 365); cookie.hidden = true; });
    if (no) no.addEventListener('click', () => { cset('cosmo_ack', '1', 365); cset('cosmo_notrack', '1', 365); cookie.hidden = true; });
  }

  window.openFunnel = openFunnel;
})();
