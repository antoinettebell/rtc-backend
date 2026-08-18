const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const pageShell = ({ title, body, scripts = '' }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escapeHtml(title)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#0f172a;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh}.wrap{width:min(100% - 28px,480px);margin:auto;padding:24px 0}.card{background:#fff;color:#172033;border-radius:22px;padding:24px;box-shadow:0 18px 48px #02061766}.brand{color:#f97316;font-weight:800;letter-spacing:.04em}.muted{color:#64748b}.pill{display:inline-block;padding:6px 11px;border-radius:999px;background:#fff7ed;color:#c2410c;font-weight:700}.qr{display:flex;justify-content:center;padding:22px 0}.status{padding:14px;border-radius:12px;text-align:center;font-weight:800;margin-top:18px}.active{background:#dcfce7;color:#166534}.bad{background:#fee2e2;color:#991b1b}.button{width:100%;border:0;border-radius:14px;padding:15px;background:#ea580c;color:white;font-size:16px;font-weight:800}.reader{overflow:hidden;border-radius:16px;background:#020617}.result{padding:16px;border-radius:14px;margin:18px 0;text-align:center;font-weight:800;display:none}.result:before{display:block;font-size:72px;line-height:1;margin-bottom:10px}.success{display:block;background:#dcfce7;color:#166534}.success:before{content:"✓"}.error{display:block;background:#fee2e2;color:#991b1b}.error:before{content:"✕"}.processing{display:block;background:#fef3c7;color:#92400e}.processing:before{content:"…"}
</style></head><body>${body}${scripts}</body></html>`;

const renderTicketPage = ({ ticket, event, qrDataUrl }) => {
  const active = ticket.status === 'ACTIVE';
  const statusLabel = ticket.status.replaceAll('_', ' ');
  return pageShell({
    title: `${event.event_name} Ticket`,
    body: `<main class="wrap"><div class="card"><div class="brand">ROUND DA' CORNER</div><h1>${escapeHtml(
      event.event_name
    )}</h1><span class="pill">${escapeHtml(ticket.ticket_type)} Ticket</span><h2>${escapeHtml(
      ticket.attendee_label
    )}</h2><p class="muted">${escapeHtml(event.event_address)}, ${escapeHtml(
      event.event_city
    )}, ${escapeHtml(event.event_state)}</p><div id="qr" class="qr">${
      active && qrDataUrl
        ? `<img src="${escapeHtml(qrDataUrl)}" width="240" height="240" alt="Ticket QR code">`
        : ''
    }</div><div class="status ${
      active ? 'active' : 'bad'
    }">${escapeHtml(statusLabel)}</div><p class="muted">Present this QR code at event check-in. Each ticket may be admitted once.</p></div></main>`,
  });
};

const renderScannerPage = ({ event, sessionToken }) =>
  pageShell({
    title: `${event.event_name} Check-In`,
    body: `<main class="wrap"><div class="brand">ROUND DA' CORNER</div><h1>${escapeHtml(
      event.event_name
    )}</h1><p>Ticket Check-In</p><div id="result" class="result"></div><div id="reader" class="reader"></div><button id="toggle" class="button">Start Scanner</button></main>`,
    scripts: `<script src="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"></script><script>
const session=${JSON.stringify(sessionToken)},eventId=${JSON.stringify(event.event_id)};let scanner=null,running=false,busy=false;
const result=document.getElementById('result'),button=document.getElementById('toggle');
function show(type,text){result.className='result '+type;result.textContent=text}
async function closeCamera(){if(scanner&&running)await scanner.stop().catch(()=>{});if(scanner)await scanner.clear().catch(()=>{});scanner=null;running=false}
async function stop(){await closeCamera();button.textContent='Start Scanner'}
async function start(){if(running||busy)return;result.className='result';result.textContent='';scanner=new Html5Qrcode('reader');await scanner.start({facingMode:'environment'},{fps:12,qrbox:{width:250,height:250}},scan).then(()=>{running=true;button.textContent='Stop Scanner'}).catch(()=>{scanner=null;show('error','Camera permission is required.')})}
async function scan(decoded){if(busy)return;busy=true;show('processing','Validating ticket…');if(navigator.vibrate)navigator.vibrate(100);await closeCamera();try{const token=new URL(decoded).pathname.split('/').filter(Boolean).pop();const response=await fetch('/api/v1/public/marketplace/tickets/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_id:eventId,scanner_session_token:session,ticket_token:token})});const data=await response.json();if(!response.ok||!data.success)throw new Error(data.message||'Ticket is invalid');const value=data.data||data;if(navigator.vibrate)navigator.vibrate([100,50,100]);show('success','CHECKED IN: '+value.attendeeName+' ('+value.ticketType+')')}catch(error){if(navigator.vibrate)navigator.vibrate(400);show('error',error.message)}finally{busy=false;button.textContent='Scan Next Ticket'}}
button.addEventListener('click',()=>running?stop():start());
</script>`,
  });

module.exports = { escapeHtml, renderTicketPage, renderScannerPage };
