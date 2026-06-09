/* GitHub funnel + Razorpay tipping + tracking consent.
   The GitHub icon never links straight to GitHub: it opens this modal, captures
   the email (required) to /api/subscribe.php, optionally runs a Razorpay tip, then
   fetches the repo URL from the backend and redirects. */
(function () {
  'use strict';
  const COSMO = window.COSMO || {};
  const modal = document.getElementById('funnel');
  const form = document.getElementById('funnel-form');
  const msg = document.getElementById('funnel-msg');
  const submit = document.getElementById('funnel-submit');
  const eyesBox = document.getElementById('funnel-eyes');
  let selectedAmt = 0;
  let modalEyes = null;

  const hasRzp = COSMO.razorpayKeyId && !/REPLACE/i.test(COSMO.razorpayKeyId);

  function openFunnel(preset) {
    if (!modal) return;
    modal.hidden = false;
    if (!modalEyes && eyesBox && window.CosmoEyes) {
      modalEyes = new CosmoEyes(eyesBox, { scale: 0.9 });
      setTimeout(() => modalEyes.setState('happy'), 200);
    }
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

  async function runPayment(email) {
    const order = await postJSON('api/create_order.php', { amount: selectedAmt, email: email });
    return new Promise((resolve, reject) => {
      const rzp = new window.Razorpay({
        key: order.key_id, order_id: order.order_id,
        amount: order.amount, currency: order.currency,
        name: 'Cosmo', description: 'Buy me a coffee ☕',
        prefill: { email: email }, theme: { color: '#4a9eff' },
        handler: async (resp) => {
          try {
            const v = await postJSON('api/verify_payment.php', {
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
              email: email,
            });
            resolve(v);
          } catch (err) { reject(err); }
        },
        modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
      });
      rzp.open();
    });
  }

  if (form) form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = form.querySelector('input[name=email]').value.trim();
    const consent = form.querySelector('input[name=consent]').checked ? 1 : 0;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setMsg('Please enter a valid email.', 'err'); return; }

    const customVal = parseInt(form.querySelector('input[name=custom]').value, 10);
    if (customVal > 0) selectedAmt = customVal;

    submit.disabled = true; setMsg('Saving…');
    try {
      const sub = await postJSON('api/subscribe.php', { email: email, consent: consent });

      if (selectedAmt > 0 && hasRzp) {
        setMsg('Opening secure checkout…');
        const v = await runPayment(email);
        if (v.repo_url) return go(v.repo_url);
        setMsg('Thank you so much! ☕ The repo link is on its way to your inbox.', 'ok');
        return;
      }

      // No tip (or tipping not configured yet).
      if (sub.repo_url) return go(sub.repo_url);
      if (sub.require_payment && hasRzp) { setMsg('A coffee unlocks the repo ☕ — pick an amount above.', 'err'); submit.disabled = false; return; }
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
  document.querySelectorAll('#tip-row .tip').forEach((b) =>
    b.addEventListener('click', () => selectAmount(b.dataset.amt)));
  // Support page tip buttons open the modal pre-selected.
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
