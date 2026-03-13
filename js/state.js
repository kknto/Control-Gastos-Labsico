// State management - API Version
let state = {
    transactions: [],
    services: [],
    sheets: [],
    currentSheetRows: [],
    categories: ['Ventas', 'Nómina', 'Renta', 'Impuestos (IVA/ISR)', 'Cuotas (IMSS/INFONAVIT)', 'Vehículos', 'Servicios', 'Otros'],
    fixedCosts: {}
};

function normalizeService(svc) {
    const normalized = { ...svc };
    if (!normalized.status) normalized.status = normalized.payment_status || 'pendiente';
    if (!normalized.next_billing_date) normalized.next_billing_date = normalized.next_payment_date || '';
    return normalized;
}

async function apiFetch(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'same-origin',
        ...options
    });

    if (response.status === 401) {
        window.location.href = '/login';
        throw new Error('authentication_required');
    }

    return response;
}

const API = {
    async loadState() {
        try {
            const [txRes, settingsRes, svcRes, sheetsRes] = await Promise.all([
                apiFetch('/api/transactions'),
                apiFetch('/api/settings'),
                apiFetch('/api/services'),
                apiFetch('/api/sheets')
            ]);

            state.transactions = await txRes.json();
            state.services = (await svcRes.json()).map(normalizeService);
            state.sheets = await sheetsRes.json();
            const settings = await settingsRes.json();

            state.categories = settings.categories && settings.categories.length > 0
                ? settings.categories
                : ['Ventas', 'Nómina', 'Renta', 'Impuestos (IVA/ISR)', 'Cuotas (IMSS/INFONAVIT)', 'Vehículos', 'Servicios', 'Otros'];

            state.fixedCosts = settings.fixedCosts || {
                payrollWeekly: 38600,
                trucksMonthly: 29235,
                servicesMonthly: 3000,
                rentMonthly: 25000,
                taxesMonthly: 0
            };
            return true;
        } catch (e) {
            console.error("Error loading state:", e);
            showToast("Error conectando con el servidor");
            return false;
        }
    },

    async addTransaction(tx) {
        const res = await apiFetch('/api/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tx)
        });
        const saved = await res.json();
        state.transactions.push(saved);
    },

    async updateTransaction(tx) {
        await apiFetch(`/api/transactions/${tx.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tx)
        });
        const idx = state.transactions.findIndex(t => t.id === tx.id);
        if (idx !== -1) state.transactions[idx] = tx;
    },

    async deleteTransaction(id) {
        await apiFetch(`/api/transactions/${id}`, { method: 'DELETE' });
        state.transactions = state.transactions.filter(t => t.id !== id);
    },

    async deleteTransactionsBulk(ids) {
        await apiFetch('/api/transactions/bulk', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        state.transactions = state.transactions.filter(t => !ids.includes(t.id));
    },

    async saveCategories(cats) {
        state.categories = cats;
        await apiFetch('/api/settings/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cats)
        });
    },

    async saveFixedCosts(costs) {
        state.fixedCosts = costs;
        await apiFetch('/api/settings/fixedCosts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(costs)
        });
    },

    // Services API
    async addService(svc) {
        const res = await apiFetch('/api/services', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(svc)
        });
        const saved = normalizeService(await res.json());
        state.services.push(saved);
    },

    async updateService(svc) {
        await apiFetch(`/api/services/${svc.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(svc)
        });
        const idx = state.services.findIndex(s => s.id === svc.id);
        if (idx !== -1) state.services[idx] = normalizeService(svc);
    },

    async deleteService(id) {
        await apiFetch(`/api/services/${id}`, { method: 'DELETE' });
        state.services = state.services.filter(s => s.id !== id);
    },

    // Sheets API
    async loadSheets() {
        const res = await apiFetch('/api/sheets');
        state.sheets = await res.json();
    },

    async createSheet(sheet) {
        const res = await apiFetch('/api/sheets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sheet)
        });
        const saved = await res.json();
        state.sheets.unshift(saved); // Add to top
    },

    async deleteSheet(id) {
        await apiFetch(`/api/sheets/${id}`, { method: 'DELETE' });
        state.sheets = state.sheets.filter(s => s.id !== id);
    },

    async loadSheetRows(sheetId) {
        const res = await apiFetch(`/api/sheets/${sheetId}/rows`);
        state.currentSheetRows = await res.json();
    },

    async addSheetRow(row) {
        const res = await apiFetch('/api/sheet-rows', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(row)
        });
        const saved = await res.json();
        state.currentSheetRows.push(saved);
        return saved;
    },

    async deleteSheetRow(id) {
        await apiFetch(`/api/sheet-rows/${id}`, { method: 'DELETE' });
        state.currentSheetRows = state.currentSheetRows.filter(r => r.id !== id);
    },

    async loadSession() {
        const res = await apiFetch('/api/auth/session');
        return res.json();
    },

    async logout() {
        await apiFetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
    }
};

// Legacy shim for existing calls if any
function saveState() {
    // No-op in API mode, individual actions trigger saves
}
