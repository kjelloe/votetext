/* ===== View: Login ===== */
async function viewLogin() {
    if (state.user) { location.hash = '#/documents'; return; }

    const form = el('div', { class: 'login-container' });
    form.innerHTML = `
        <div class="login-card">
            <h1>VoteText</h1>
            <p class="subtitle">Enter your email to get a login code</p>
            <div id="step-email">
                <div class="form-group">
                    <label for="email-input">Email address</label>
                    <input type="email" id="email-input" placeholder="you@example.com" autocomplete="email">
                </div>
                <p id="email-err" class="error-msg" style="display:none"></p>
                <button id="send-btn" class="btn btn-primary" style="width:100%">Send code</button>
            </div>
            <div id="step-otp" style="display:none">
                <p class="text-muted mb-2">Code sent to <strong id="otp-email"></strong></p>
                <div class="form-group">
                    <label for="otp-input">6-digit code</label>
                    <input type="text" id="otp-input" placeholder="123456" maxlength="6" autocomplete="one-time-code" inputmode="numeric"
                        style="font-family:var(--font-mono);font-size:1.75rem;letter-spacing:.3em;text-align:center">
                </div>
                <p id="otp-err" class="error-msg" style="display:none"></p>
                <button id="verify-btn" class="btn btn-primary" style="width:100%">Verify</button>
                <button id="back-btn" class="btn btn-ghost mt-1" style="width:100%">Use different email</button>
            </div>
        </div>
    `;
    setMain(form);

    const emailInput = document.getElementById('email-input');
    const sendBtn = document.getElementById('send-btn');
    const emailErr = document.getElementById('email-err');
    const otpInput = document.getElementById('otp-input');
    const verifyBtn = document.getElementById('verify-btn');
    const otpErr = document.getElementById('otp-err');

    emailInput.focus();
    emailInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendBtn.click(); });

    sendBtn.addEventListener('click', async () => {
        emailErr.style.display = 'none';
        const email = emailInput.value.trim();
        if (!email || !email.includes('@')) { emailErr.textContent = 'Valid email required'; emailErr.style.display = ''; return; }
        sendBtn.disabled = true; sendBtn.textContent = 'Sending…';
        try {
            await api('POST', '/auth/request-otp', { email });
            document.getElementById('step-email').style.display = 'none';
            document.getElementById('step-otp').style.display = '';
            document.getElementById('otp-email').textContent = email;
            otpInput.focus();
        } catch (err) {
            emailErr.textContent = err.message; emailErr.style.display = '';
            sendBtn.disabled = false; sendBtn.textContent = 'Send code';
        }
    });

    otpInput.addEventListener('input', () => {
        if (otpInput.value.replace(/\D/g, '').length === 6) verifyBtn.click();
    });
    otpInput.addEventListener('keydown', e => { if (e.key === 'Enter') verifyBtn.click(); });

    verifyBtn.addEventListener('click', async () => {
        otpErr.style.display = 'none';
        const code = otpInput.value.replace(/\D/g, '');
        if (!code) { otpErr.textContent = 'Code required'; otpErr.style.display = ''; return; }
        verifyBtn.disabled = true; verifyBtn.textContent = 'Verifying…';
        try {
            const data = await api('POST', '/auth/verify-otp', { email: document.getElementById('otp-email').textContent, code });
            state.user = data.user;
            updateHeader();
            if (!state.user.display_name) { showProfileModal(() => { location.hash = '#/documents'; }); return; }
            location.hash = '#/documents';
        } catch (err) {
            otpErr.textContent = err.message; otpErr.style.display = '';
            verifyBtn.disabled = false; verifyBtn.textContent = 'Verify';
        }
    });

    document.getElementById('back-btn').addEventListener('click', () => {
        document.getElementById('step-otp').style.display = 'none';
        document.getElementById('step-email').style.display = '';
        emailInput.focus();
    });
}

/* ===== View: Profile ===== */
async function viewProfile() {
    if (!state.user) { location.hash = '#/login'; return; }

    const wrap = el('div', { class: 'profile-container' });
    wrap.innerHTML = `
        <h1 class="page-title mb-2">Profile</h1>
        <div class="card">
            <div class="form-group"><label>Email</label><input type="text" value="${esc(state.user.email)}" disabled></div>
            <div class="form-group"><label>Display name</label><input type="text" id="profile-name" value="${esc(state.user.display_name || '')}"></div>
            <div class="form-group"><label>Organization</label><input type="text" id="profile-org" value="${esc(state.user.organization || '')}"></div>
            <div class="form-group">
                <label><input type="checkbox" id="profile-nonsearchable" ${state.user.is_non_searchable ? 'checked' : ''}> Non-searchable profile — hide me from user search results</label>
            </div>
            <p id="profile-err" class="error-msg" style="display:none"></p>
            <p id="profile-ok" class="text-success" style="display:none">Saved!</p>
            <div class="form-actions">
                <button id="save-profile-btn" class="btn btn-primary">Save profile</button>
            </div>
        </div>
    `;
    setMain(wrap);

    document.getElementById('save-profile-btn').addEventListener('click', async () => {
        const errEl = document.getElementById('profile-err');
        const okEl = document.getElementById('profile-ok');
        errEl.style.display = 'none'; okEl.style.display = 'none';
        try {
            const d = await api('PATCH', '/auth/profile', { display_name: document.getElementById('profile-name').value.trim(), organization: document.getElementById('profile-org').value.trim(), is_non_searchable: document.getElementById('profile-nonsearchable').checked ? 1 : 0 });
            state.user = d.user; updateHeader(); okEl.style.display = '';
        } catch (err) { errEl.textContent = err.message; errEl.style.display = ''; }
    });
}

/* ===== Profile completion modal ===== */
function showProfileModal(onDone) {
    openModal(`<div class="form-group"><label>Email</label><input type="text" value="${esc(state.user.email)}" disabled></div>
        <div class="form-group"><label>Display name</label><input type="text" id="pm-name" value="${esc(state.user.display_name||'')}"></div>
        <div class="form-group"><label>Organization <span class="text-muted">(optional)</span></label><input type="text" id="pm-org" value="${esc(state.user.organization||'')}"></div>
        <div class="flex gap-1 mt-2"><button id="pm-skip" class="btn btn-ghost btn-sm">Skip for now</button><button id="pm-save" class="btn btn-primary btn-sm">Save and continue</button></div>`,
        'Complete your profile');
    document.getElementById('pm-skip').onclick = () => { closeModal(); onDone(); };
    document.getElementById('pm-save').onclick = async () => {
        try { const d = await api('PATCH', '/auth/profile', { display_name: document.getElementById('pm-name').value.trim(), organization: document.getElementById('pm-org').value.trim() }); state.user = d.user; updateHeader(); } catch {}
        closeModal(); onDone();
    };
}
