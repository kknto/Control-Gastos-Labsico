async function loginRequest(payload) {
    const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    return { response, data };
}

function setLoginError(message) {
    const errorEl = document.getElementById('login-error');
    if (errorEl) errorEl.textContent = message || '';
}

function setSubmitting(isSubmitting) {
    const submitBtn = document.getElementById('login-submit');
    if (!submitBtn) return;
    submitBtn.disabled = isSubmitting;
    submitBtn.textContent = isSubmitting ? 'Verificando acceso...' : 'Entrar al centro de control';
}

function bindPasswordToggle() {
    const toggleBtn = document.getElementById('toggle-password');
    const passwordInput = document.getElementById('login-password');
    if (!toggleBtn || !passwordInput) return;

    toggleBtn.addEventListener('click', () => {
        const isPassword = passwordInput.type === 'password';
        passwordInput.type = isPassword ? 'text' : 'password';
        toggleBtn.innerHTML = isPassword
            ? '<i data-lucide="eye-off" class="w-4 h-4"></i>'
            : '<i data-lucide="eye" class="w-4 h-4"></i>';
        if (window.lucide) lucide.createIcons();
    });
}

function bindLoginForm() {
    const form = document.getElementById('login-form');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        setLoginError('');
        setSubmitting(true);

        const username = document.getElementById('login-username')?.value.trim() || '';
        const password = document.getElementById('login-password')?.value || '';

        try {
            const { response, data } = await loginRequest({ username, password });
            if (response.ok) {
                window.location.href = '/';
                return;
            }

            if (response.status === 429) {
                const retry = data?.retry_after_seconds || 0;
                setLoginError(`Demasiados intentos. Intenta de nuevo en ${retry} segundos.`);
                return;
            }

            setLoginError('Usuario o contrasena incorrectos.');
        } catch (error) {
            console.error('Error al iniciar sesion:', error);
            setLoginError('No se pudo conectar con el servidor.');
        } finally {
            setSubmitting(false);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    bindPasswordToggle();
    bindLoginForm();
    if (window.lucide) lucide.createIcons();
});
