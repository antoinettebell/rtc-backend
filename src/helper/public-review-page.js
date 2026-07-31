const PUBLIC_REVIEW_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Review your order | Round Da' Corner</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f6f3ef; color: #171717; }
    main { width: min(100% - 32px, 520px); margin: 32px auto; }
    .card { background: white; border-radius: 18px; box-shadow: 0 12px 36px rgba(0,0,0,.08); padding: 24px; }
    .brand { color: #b95600; font-weight: 800; letter-spacing: .02em; margin-bottom: 18px; }
    .vendor { display: flex; gap: 14px; align-items: center; }
    .vendor img { width: 64px; height: 64px; border-radius: 12px; object-fit: cover; background: #eee; }
    h1 { font-size: 24px; margin: 0 0 4px; }
    .meta, .status { color: #666; font-size: 14px; }
    .stars { display: flex; justify-content: center; gap: 7px; margin: 26px 0 20px; }
    .star { appearance: none; border: 0; background: transparent; color: #c8c8c8; cursor: pointer; font-size: 44px; line-height: 1; padding: 2px; }
    .star.selected { color: #e36d00; }
    label { display: block; font-weight: 700; margin-bottom: 8px; }
    textarea { width: 100%; min-height: 120px; resize: vertical; border: 1px solid #ccc; border-radius: 10px; padding: 12px; font: inherit; }
    button.submit { width: 100%; border: 0; border-radius: 10px; padding: 14px; margin-top: 18px; color: white; background: #b95600; font-size: 17px; font-weight: 800; }
    button:disabled { cursor: not-allowed; opacity: .55; }
    .message { text-align: center; padding: 34px 10px; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <main><section class="card">
    <div class="brand">ROUND DA' CORNER</div>
    <div id="loading" class="message">Loading your review…</div>
    <div id="error" class="message hidden" role="alert"></div>
    <div id="complete" class="message hidden" role="status">
      <h1>Thank you!</h1>
      <p>Your review has been submitted. You may close this window.</p>
    </div>
    <div id="form" class="hidden">
      <div class="vendor">
        <img id="logo" alt="" class="hidden">
        <div><h1 id="vendorName"></h1><div id="orderMeta" class="meta"></div></div>
      </div>
      <div class="stars" aria-label="Choose a rating from 1 to 5 stars"></div>
      <label for="comment">Tell us about your experience (optional)</label>
      <textarea id="comment" maxlength="2000"></textarea>
      <button id="submit" class="submit" type="button" disabled>Submit review</button>
      <div id="status" class="status" role="status" aria-live="polite"></div>
    </div>
  </section></main>
  <script>
    (() => {
      const token = new URLSearchParams(location.search).get('token') || '';
      const loading = document.getElementById('loading');
      const errorBox = document.getElementById('error');
      const complete = document.getElementById('complete');
      const form = document.getElementById('form');
      const submit = document.getElementById('submit');
      const status = document.getElementById('status');
      const comment = document.getElementById('comment');
      let rating = 0;
      const showError = (message) => {
        loading.classList.add('hidden'); form.classList.add('hidden');
        errorBox.textContent = message; errorBox.classList.remove('hidden');
      };
      const apiMessage = (payload, fallback) =>
        payload?.message || payload?.error?.message || fallback;
      const renderStars = () => {
        const root = document.querySelector('.stars'); root.textContent = '';
        for (let value = 1; value <= 5; value += 1) {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'star' + (value <= rating ? ' selected' : '');
          button.textContent = '★'; button.setAttribute('aria-label', value + ' star');
          button.addEventListener('click', () => { rating = value; submit.disabled = false; renderStars(); });
          root.appendChild(button);
        }
      };

      if (!token) { showError('This review link is invalid.'); return; }
      fetch('/api/v1/public/review-token/' + encodeURIComponent(token), { headers: { Accept: 'application/json' } })
        .then(async (response) => {
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || payload.success === false) throw new Error(apiMessage(payload, 'This review link is invalid or expired.'));
          return payload.data?.reviewToken;
        })
        .then((details) => {
          if (!details) throw new Error('Review details are temporarily unavailable.');
          if (details.alreadyReviewed) {
            loading.classList.add('hidden');
            complete.classList.remove('hidden');
            return;
          }
          rating = Number(details.review?.rating || 0);
          comment.value = details.review?.comment || '';
          document.getElementById('vendorName').textContent = details.foodTruckName || 'Food truck';
          const date = details.orderDate ? new Date(details.orderDate).toLocaleDateString() : '';
          document.getElementById('orderMeta').textContent = [details.orderReference, date].filter(Boolean).join(' • ');
          if (details.foodTruckLogo) {
            const logo = document.getElementById('logo'); logo.src = details.foodTruckLogo; logo.alt = (details.foodTruckName || 'Vendor') + ' logo'; logo.classList.remove('hidden');
          }
          submit.disabled = rating === 0; renderStars();
          loading.classList.add('hidden'); form.classList.remove('hidden');
        })
        .catch((error) => showError(error.message));

      submit.addEventListener('click', async () => {
        if (!rating) return;
        submit.disabled = true; status.textContent = 'Saving…';
        try {
          const response = await fetch('/api/v1/public/review-token/' + encodeURIComponent(token), {
            method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ rate: rating, review: comment.value.trim() }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || payload.success === false) throw new Error(apiMessage(payload, 'Unable to save your review.'));
          form.classList.add('hidden');
          complete.classList.remove('hidden');
          setTimeout(() => window.close(), 500);
        } catch (error) { status.textContent = error.message; }
        finally { submit.disabled = false; }
      });
    })();
  </script>
</body>
</html>`;

exports.renderPublicReviewPage = (req, res) => {
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  return res.status(200).send(PUBLIC_REVIEW_HTML);
};

exports.PUBLIC_REVIEW_HTML = PUBLIC_REVIEW_HTML;
