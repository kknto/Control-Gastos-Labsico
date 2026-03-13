let editingTransactionId = null;
let editingServiceId = null;
let activeSheetId = null;
let currentSelection = new Set();
let expandState = {};
let editingSheetRowId = null;
let movingSheetRowId = null;
let draggingSheetRowId = null;

let barChartInstance = null;
let fixedCostChartInstance = null;
let projectionChartInstance = null;
let tableGrouping = 'none';
let groupExpandState = {};
let transactionSelection = new Set();

// Date Filter State
let dateFilter = {
    startDate: null,
    endDate: null,
    active: false,
    label: ''
};

// Utilities
function standardizeDate(val) {
    if (!val) return new Date().toISOString().split('T')[0];
    const clean = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;

    // DD/MM/YYYY or DD-MM-YYYY
    let match = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (match) {
        return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    }

    // YYYY/MM/DD
    match = clean.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (match) {
        return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    }

    try {
        const d = new Date(clean);
        if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    } catch (e) { }
    return new Date().toISOString().split('T')[0];
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN'
    }).format(amount);
}

function formatShortDate(date) {
    return date.toLocaleDateString('es-MX');
}

function parseTxDate(value) {
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
}

function isWithinRange(dateValue, range) {
    const d = parseTxDate(dateValue);
    return d >= range.start && d <= range.end;
}

function getDaysBetween(start, end) {
    const ms = end.getTime() - start.getTime();
    return Math.max(1, Math.floor(ms / (24 * 60 * 60 * 1000)) + 1);
}

function normalizeCategoryKey(value) {
    return (value || '').toLowerCase().replace(/[^a-z]/g, '');
}

function getTransactionDisplayCategory(transaction) {
    const baseCategory = (transaction?.category || 'Sin categoria').trim() || 'Sin categoria';
    if (baseCategory !== 'Efectivo') return baseCategory;
    if (transaction?.type === 'ingreso') return 'Efectivo - Ingresos';
    if (transaction?.type === 'egreso') return 'Efectivo - Egresos';
    return baseCategory;
}

function isCashTransaction(transaction) {
    return ((transaction?.category || '').trim() === 'Efectivo');
}

function getDashboardRange() {
    const select = document.getElementById('dashboard-range');
    const value = select?.value || 'ytd';
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const year = today.getFullYear();

    let start = new Date(year, 0, 1);
    let end = new Date(today);
    let label = '';

    if (value === 'q1') {
        start = new Date(year, 0, 1);
        end = new Date(year, 2, 31, 23, 59, 59, 999);
        if (end > today) end = new Date(today);
        label = `Q1 ${year}: ${formatShortDate(start)} - ${formatShortDate(end)}`;
    } else if (value === 'last6') {
        const startMonth = new Date(today.getFullYear(), today.getMonth() - 5, 1);
        start = startMonth;
        end = new Date(today);
        label = `Ultimos 6 meses: ${formatShortDate(start)} - ${formatShortDate(end)}`;
    } else if (value === 'last12') {
        const startMonth = new Date(today.getFullYear(), today.getMonth() - 11, 1);
        start = startMonth;
        end = new Date(today);
        label = `Ultimos 12 meses: ${formatShortDate(start)} - ${formatShortDate(end)}`;
    } else {
        start = new Date(year, 0, 1);
        end = new Date(today);
        label = `YTD ${year}: ${formatShortDate(start)} - ${formatShortDate(end)}`;
    }

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end, label, type: value };
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = "fixed bottom-4 right-4 bg-slate-800 text-white px-6 py-3 rounded-xl shadow-2xl z-50 animate-bounce";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function exportData() {
    const payload = {
        exported_at: new Date().toISOString(),
        transactions: state.transactions,
        services: state.services,
        categories: state.categories,
        fixedCosts: state.fixedCosts,
        sheets: state.sheets,
        sheetRows: state.currentSheetRows
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `finanzas_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function exportDashboardPdf() {
    showTab('dashboard');
    window.print();
}

// Navigation
function showTab(tabId) {
    ['landing', 'dashboard', 'registro', 'config', 'services', 'breakdown'].forEach(t => {
        const tab = document.getElementById(`tab-${t}`);
        const btn = document.getElementById(`btn-${t}`);
        if (tab) tab.classList.add('hidden');
        if (btn) {
            btn.classList.remove('tab-active');
            btn.classList.add('text-slate-500');
        }
    });

    const activeTab = document.getElementById(`tab-${tabId}`);
    const activeBtn = document.getElementById(`btn-${tabId}`);
    if (activeTab) activeTab.classList.remove('hidden');
    if (activeBtn) activeBtn.classList.add('tab-active');

    if (tabId === 'dashboard') initCharts();
    if (tabId === 'breakdown') renderSheetsList();
}

// Transactions
async function saveTransaction() {
    const date = document.getElementById('input-fecha').value;
    const category = document.getElementById('input-categoria').value;
    const concept = document.getElementById('input-concepto').value;
    const subtotal = parseFloat(document.getElementById('input-subtotal').value) || 0;
    const iva = parseFloat(document.getElementById('input-iva').value) || 0;
    const amount = parseFloat(document.getElementById('input-monto').value);
    const type = document.getElementById('input-tipo').value;
    const status = document.getElementById('input-estatus').value;

    if (!date || !concept || isNaN(amount)) {
        alert('Por favor completa todos los campos obligatorios');
        return;
    }

    const tx = { date, category, concept, amount, type, status, subtotal, iva };

    if (editingTransactionId) {
        tx.id = editingTransactionId;
        await API.updateTransaction(tx);
        editingTransactionId = null;
        setTransactionMode(false);
    } else {
        await API.addTransaction(tx);
    }

    clearTxForm();
    renderTable();
    initCharts();
    showToast("Transacción guardada");
}

function clearTxForm() {
    document.getElementById('input-concepto').value = '';
    document.getElementById('input-subtotal').value = '';
    document.getElementById('input-iva').value = '';
    document.getElementById('input-monto').value = '';
    document.getElementById('input-fecha').valueAsDate = new Date();
    document.getElementById('input-estatus').value = 'Pagado';
    editingTransactionId = null;
    setTransactionMode(false);
}

function setTransactionMode(isEditing) {
    const cancelBtn = document.getElementById('btn-cancel-edit');
    const btnText = document.getElementById('btn-text');

    if (cancelBtn) {
        cancelBtn.classList.toggle('hidden', !isEditing);
    }
    if (btnText) {
        btnText.textContent = isEditing ? 'Actualizar' : 'Guardar Registro';
    }
}

function editTransaction(id) {
    const t = state.transactions.find(tx => tx.id === id);
    if (!t) return;

    editingTransactionId = id;
    document.getElementById('input-fecha').value = t.date;
    document.getElementById('input-categoria').value = t.category;
    document.getElementById('input-concepto').value = t.concept;
    document.getElementById('input-subtotal').value = t.subtotal ?? '';
    document.getElementById('input-iva').value = t.iva ?? '';
    document.getElementById('input-monto').value = t.amount;
    document.getElementById('input-tipo').value = t.type;
    document.getElementById('input-estatus').value = t.status;

    setTransactionMode(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEdit() {
    editingTransactionId = null;
    clearTxForm();
}

document.getElementById('entryForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveTransaction();
});

async function deleteTransaction(id) {
    if (confirm("¿Eliminar esta transacción?")) {
        await API.deleteTransaction(id);
        renderTable();
        initCharts();
        showToast("Transacción eliminada");
    }
}

async function deleteBatchTransactions() {
    if (transactionSelection.size === 0) return;
    if (confirm(`¿Eliminar ${transactionSelection.size} transacciones seleccionadas?`)) {
        const ids = Array.from(transactionSelection);
        await API.deleteTransactionsBulk(ids);
        transactionSelection.clear();
        updateBulkDeleteButton();
        renderTable();
        initCharts();
        showToast(`${ids.length} transacciones eliminadas`);
    }
}

function toggleTransactionSelection(id) {
    if (transactionSelection.has(id)) {
        transactionSelection.delete(id);
    } else {
        transactionSelection.add(id);
    }
    updateBulkDeleteButton();
}

function toggleSelectAllTransactions(checked) {
    const checkboxes = document.querySelectorAll('.tx-checkbox');
    checkboxes.forEach(cb => {
        const id = parseInt(cb.dataset.id);
        if (checked) {
            transactionSelection.add(id);
        } else {
            transactionSelection.delete(id);
        }
        cb.checked = checked;
    });
    updateBulkDeleteButton();
}

function updateBulkDeleteButton() {
    const btn = document.getElementById('btn-delete-bulk');
    const countEl = document.getElementById('selected-count');
    if (btn && countEl) {
        const count = transactionSelection.size;
        countEl.textContent = count;
        if (count > 0) {
            btn.classList.remove('hidden');
        } else {
            btn.classList.add('hidden');
            const selectAll = document.getElementById('select-all-tx');
            if (selectAll) selectAll.checked = false;
        }
    }
}

function setTableGrouping(value) {
    tableGrouping = value || 'none';
    groupExpandState = {};
    const select = document.getElementById('group-by');
    if (select && select.value !== tableGrouping) {
        select.value = tableGrouping;
    }
    renderTable();
}

function toggleGroupRow(groupId) {
    const expanded = groupExpandState[groupId] !== false;
    groupExpandState[groupId] = !expanded;
    renderTable();
}

function appendTransactionRow(tbody, t, index, isGrouped) {
    const row = document.createElement('tr');
    row.className = "hover:bg-slate-50 transition-colors group slide-up";
    row.style.animationDelay = `${index * 0.05}s`;

    const conceptPadding = isGrouped ? 'pl-10' : '';
    const isChecked = transactionSelection.has(t.id);
    const displayCategory = getTransactionDisplayCategory(t);
    row.innerHTML = `
        <td class="px-6 py-4 w-4">
            <input type="checkbox" class="tx-checkbox rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" 
                data-id="${t.id}" ${isChecked ? 'checked' : ''} onchange="toggleTransactionSelection(${t.id})">
        </td>
        <td class="px-2 py-4 text-slate-500 font-medium">${t.date}</td>
        <td class="px-6 py-4">
            <span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[10px] font-bold">${displayCategory}</span>
        </td>
        <td class="px-6 py-4 font-semibold text-slate-800 ${conceptPadding}">
            <div>${t.concept}</div>
            ${t.subtotal || t.iva ? `
                <div class="text-[9px] text-slate-400 font-normal mt-0.5">
                    Sub: ${formatCurrency(t.subtotal || 0)} | IVA: ${formatCurrency(t.iva || 0)}
                </div>
            ` : ''}
        </td>
        <td class="px-6 py-4 text-right font-bold ${t.type === 'ingreso' ? 'text-emerald-600' : 'text-rose-600'}">
            ${t.type === 'ingreso' ? '+' : '-'}${formatCurrency(t.amount)}
        </td>
        <td class="px-6 py-4 text-center">
            <span class="text-[9px] font-black px-2 py-1 rounded ${t.status === 'Pagado' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}">
                ${t.status.toUpperCase()}
            </span>
        </td>
        <td class="px-6 py-4 text-right opacity-0 group-hover:opacity-100 transition-opacity">
            <button onclick="editTransaction(${t.id})" class="text-blue-500 hover:text-blue-700 mr-2" title="Editar">
                <i data-lucide="pencil" class="w-4 h-4"></i>
            </button>
            <button onclick="deleteTransaction(${t.id})" class="text-rose-500 hover:text-rose-700" title="Eliminar">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
        </td>
    `;
    tbody.appendChild(row);
}

function renderGroupedTable(tbody, transactions) {
    const groups = new Map();

    transactions.forEach((t) => {
        const key = tableGrouping === 'type'
            ? (t.type || 'otro')
            : getTransactionDisplayCategory(t);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(t);
    });

    const orderMap = new Map(state.categories.map((c, i) => [c, i]));
    const getCategorySortMeta = (category) => {
        if (category === 'Efectivo - Ingresos') {
            return {
                order: orderMap.has('Efectivo') ? orderMap.get('Efectivo') : 999,
                variant: 0
            };
        }
        if (category === 'Efectivo - Egresos') {
            return {
                order: orderMap.has('Efectivo') ? orderMap.get('Efectivo') : 999,
                variant: 1
            };
        }
        return {
            order: orderMap.has(category) ? orderMap.get(category) : 999,
            variant: 2
        };
    };
    const entries = Array.from(groups.entries()).sort((a, b) => {
        if (tableGrouping === 'type') {
            const order = { ingreso: 0, egreso: 1, otro: 2 };
            return (order[a[0]] ?? 9) - (order[b[0]] ?? 9);
        }
        const aMeta = getCategorySortMeta(a[0]);
        const bMeta = getCategorySortMeta(b[0]);
        if (aMeta.order !== bMeta.order) return aMeta.order - bMeta.order;
        if (aMeta.variant !== bMeta.variant) return aMeta.variant - bMeta.variant;
        return a[0].localeCompare(b[0]);
    });

    let rowIndex = 0;
    entries.forEach(([key, items]) => {
        const groupId = encodeURIComponent(key);
        const isExpanded = groupExpandState[groupId] !== false;
        const label = tableGrouping === 'type'
            ? (key === 'ingreso' ? 'Ingresos' : key === 'egreso' ? 'Egresos' : 'Otros')
            : key;

        const total = items.reduce((acc, t) => acc + (t.type === 'ingreso' ? t.amount : -t.amount), 0);

        const groupRow = document.createElement('tr');
        groupRow.className = "bg-slate-50/80 text-slate-700 cursor-pointer";
        groupRow.innerHTML = `
            <td colspan="4" class="px-6 py-3 font-bold">
                <div class="flex items-center gap-2">
                    <i data-lucide="${isExpanded ? 'chevron-down' : 'chevron-right'}" class="w-4 h-4"></i>
                    <span>${label}</span>
                    <span class="text-xs text-slate-400 font-semibold">(${items.length})</span>
                </div>
            </td>
            <td class="px-6 py-3 text-right font-black ${total >= 0 ? 'text-emerald-600' : 'text-rose-600'}">
                ${total >= 0 ? '+' : '-'}${formatCurrency(Math.abs(total))}
            </td>
            <td colspan="2"></td>
        `;
        groupRow.addEventListener('click', () => toggleGroupRow(groupId));
        tbody.appendChild(groupRow);

        if (isExpanded) {
            items.forEach((t) => {
                appendTransactionRow(tbody, t, rowIndex, true);
                rowIndex += 1;
            });
        }
    });
}

function renderTable() {
    const tbody = document.getElementById('table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Check if select-all should be unchecked if selection was cleared
    if (transactionSelection.size === 0) {
        const selectAll = document.getElementById('select-all-tx');
        if (selectAll) selectAll.checked = false;
    }
    updateBulkDeleteButton();

    // Apply date filter if active
    let filtered = [...state.transactions];
    if (dateFilter.active && dateFilter.startDate && dateFilter.endDate) {
        filtered = filtered.filter(t => {
            const txDate = new Date(t.date);
            // normalization for date comparison
            const checkDate = new Date(txDate.getFullYear(), txDate.getMonth(), txDate.getDate());
            const start = new Date(dateFilter.startDate.getFullYear(), dateFilter.startDate.getMonth(), dateFilter.startDate.getDate());
            const end = new Date(dateFilter.endDate.getFullYear(), dateFilter.endDate.getMonth(), dateFilter.endDate.getDate());
            return checkDate >= start && checkDate <= end;
        });
    }

    const sorted = filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (tableGrouping === 'none') {
        sorted.forEach((t, index) => appendTransactionRow(tbody, t, index, false));
    } else {
        renderGroupedTable(tbody, sorted);
    }

    // Update filter indicator
    const indicator = document.getElementById('filter-indicator');
    if (indicator) {
        if (dateFilter.active && dateFilter.label) {
            indicator.textContent = dateFilter.label;
            indicator.classList.remove('hidden');
        } else {
            indicator.classList.add('hidden');
        }
    }

    // Update filtered summary
    updateFilteredSummary(filtered);

    if (window.lucide) lucide.createIcons();
}

// Services Management
function renderServices() {
    const tbody = document.getElementById('services-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    state.services.forEach(s => {
        const status = s.status || s.payment_status || 'pendiente';
        const nextBilling = s.next_billing_date || s.next_payment_date || '-';

        const row = document.createElement('tr');
        row.className = "hover:bg-slate-50 transition-colors group";
        row.innerHTML = `
            <td class="px-6 py-4 font-bold text-slate-700">${s.client_name}</td>
            <td class="px-6 py-4">
                <span class="px-2 py-0.5 rounded text-[10px] font-black uppercase ${s.service_type === 'iguala' ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-600'}">
                    ${s.service_type === 'iguala' ? 'Iguala' : 'Proyecto'}
                </span>
            </td>
            <td class="px-6 py-4 text-right font-bold text-slate-800">${formatCurrency(s.monthly_amount)}</td>
            <td class="px-6 py-4 text-center text-slate-500">${nextBilling}</td>
            <td class="px-6 py-4 text-center">
                <span class="px-2 py-1 rounded text-[9px] font-black uppercase ${status === 'pagado' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}">
                    ${status.toUpperCase()}
                </span>
            </td>
            <td class="px-6 py-4 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                <button onclick="openPaymentModal(${s.id})" class="text-emerald-500 hover:text-emerald-700 mr-2" title="Cobrar">
                    <i data-lucide="badge-dollar-sign" class="w-4 h-4"></i>
                </button>
                <button onclick="editService(${s.id})" class="text-blue-500 hover:text-blue-700 mr-2">
                    <i data-lucide="pencil" class="w-4 h-4"></i>
                </button>
                <button onclick="deleteService(${s.id})" class="text-rose-500 hover:text-rose-700">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });

    const recurring = state.services.filter(s => s.service_type === 'iguala').reduce((acc, s) => acc + s.monthly_amount, 0);
    const pending = state.services.filter(s => s.service_type === 'proyecto' && (s.status || s.payment_status) !== 'pagado').reduce((acc, s) => acc + s.monthly_amount, 0);

    if (document.getElementById('svc-total-retainers')) document.getElementById('svc-total-retainers').textContent = formatCurrency(recurring);
    if (document.getElementById('svc-pending-projects')) document.getElementById('svc-pending-projects').textContent = formatCurrency(pending);

    if (window.lucide) lucide.createIcons();
}

function openServiceModal() {
    editingServiceId = null;
    document.getElementById('modal-title-service').textContent = 'Nuevo Servicio';
    document.getElementById('serviceForm').reset();
    document.getElementById('svc-date').valueAsDate = new Date();
    document.getElementById('service-modal').classList.remove('hidden');
}

function closeServiceModal() {
    document.getElementById('service-modal').classList.add('hidden');
}

document.getElementById('serviceForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const svc = {
        client_name: document.getElementById('svc-client').value,
        service_type: document.getElementById('svc-type').value,
        monthly_amount: parseFloat(document.getElementById('svc-amount').value),
        description: document.getElementById('svc-desc').value,
        next_billing_date: document.getElementById('svc-date').value,
        status: document.getElementById('svc-status').value
    };

    if (editingServiceId) {
        svc.id = editingServiceId;
        await API.updateService(svc);
    } else {
        await API.addService(svc);
    }

    closeServiceModal();
    renderServices();
    showToast("Servicio guardado");
});

function editService(id) {
    const s = state.services.find(svc => svc.id === id);
    if (!s) return;

    editingServiceId = id;
    document.getElementById('modal-title-service').textContent = 'Editar Servicio';
    document.getElementById('svc-client').value = s.client_name;
    document.getElementById('svc-type').value = s.service_type;
    document.getElementById('svc-amount').value = s.monthly_amount;
    document.getElementById('svc-desc').value = s.description;
    document.getElementById('svc-date').value = s.next_billing_date || s.next_payment_date || '';
    document.getElementById('svc-status').value = s.status || s.payment_status || 'pendiente';

    document.getElementById('service-modal').classList.remove('hidden');
}

async function deleteService(id) {
    if (confirm("¿Eliminar este servicio?")) {
        await API.deleteService(id);
        renderServices();
        showToast("Servicio eliminado");
    }
}

function openPaymentModal(svcId) {
    const s = state.services.find(svc => svc.id === svcId);
    if (!s) return;

    document.getElementById('pay-svc-id').value = svcId;
    document.getElementById('pay-client-name').textContent = s.client_name;
    document.getElementById('pay-base').value = s.monthly_amount;
    document.getElementById('pay-extra').value = 0;
    document.getElementById('pay-notes').value = '';

    calculatePaymentTotal();
    document.getElementById('payment-modal').classList.remove('hidden');
}

function closePaymentModal() {
    document.getElementById('payment-modal').classList.add('hidden');
}

function calculatePaymentTotal() {
    const base = parseFloat(document.getElementById('pay-base').value) || 0;
    const extra = parseFloat(document.getElementById('pay-extra').value) || 0;
    document.getElementById('pay-total-display').textContent = formatCurrency(base + extra);
}

document.getElementById('paymentForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const svcId = parseInt(document.getElementById('pay-svc-id').value);
    const extra = parseFloat(document.getElementById('pay-extra').value) || 0;
    const notes = document.getElementById('pay-notes').value;
    const s = state.services.find(svc => svc.id === svcId);

    const tx = {
        date: new Date().toISOString().split('T')[0],
        category: 'Ventas',
        concept: `Cobro: ${s.client_name}${notes ? ' (' + notes + ')' : ''}`,
        amount: s.monthly_amount + extra,
        type: 'ingreso',
        status: 'Pagado'
    };

    await API.addTransaction(tx);
    if (s.service_type === 'proyecto') {
        s.status = 'pagado';
        s.payment_status = 'pagado';
        await API.updateService(s);
    }

    closePaymentModal();
    renderServices();
    renderTable();
    initCharts();
    showToast("Pago registrado");
});

document.getElementById('createSheetForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const title = document.getElementById('new-sheet-title').value.trim();
        if (!title) return;
        const created_at = new Date().toISOString().split('T')[0];
        await API.createSheet({ title, created_at });
        closeSheetModal();
        renderSheetsList();
        showToast("Hoja creada correctamente");
    } catch (err) {
        console.error("Error al crear hoja:", err);
        showToast("Error al crear la hoja");
    }
});

document.getElementById('createRowForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeSheetId) {
        showToast("Selecciona una hoja primero");
        return;
    }

    const concept = document.getElementById('new-row-concept').value.trim();
    const amount = parseFloat(document.getElementById('new-row-amount').value);
    const notes = document.getElementById('new-row-notes').value.trim();

    if (!concept || isNaN(amount)) return;

    try {
        if (editingSheetRowId) {
            const row = state.currentSheetRows.find(r => r.id === editingSheetRowId);
            if (!row) return;
            const updated = {
                ...row,
                concept,
                amount,
                notes
            };
            await fetch(`/api/sheet-rows/${editingSheetRowId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated)
            });
            const idx = state.currentSheetRows.findIndex(r => r.id === editingSheetRowId);
            if (idx !== -1) state.currentSheetRows[idx] = updated;
            await API.loadSheetRows(activeSheetId);
            closeSheetRowModal();
            renderSheetRows();
            showToast("Fila actualizada");
        } else {
            await API.addSheetRow({
                sheet_id: activeSheetId,
                concept,
                amount,
                notes
            });
            closeSheetRowModal();
            renderSheetRows();
            showToast("Fila agregada");
        }
    } catch (err) {
        console.error("Error al guardar fila:", err);
        showToast("Error al guardar la fila");
    }
});

document.getElementById('groupForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('group-name');
    const groupName = input?.value.trim();
    if (!groupName) return;

    try {
        const selectedIds = Array.from(currentSelection);
        const selectedRows = state.currentSheetRows.filter(r => selectedIds.includes(r.id));
        const totalAmount = selectedRows.reduce((acc, r) => acc + r.amount, 0);

        const parent = await API.addSheetRow({
            sheet_id: activeSheetId,
            concept: groupName,
            amount: totalAmount,
            notes: 'Agrupado'
        });

        for (const id of selectedIds) {
            const row = state.currentSheetRows.find(r => r.id === id);
            row.parent_id = parent.id;
            await fetch(`/api/sheet-rows/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(row)
            });
        }

        currentSelection.clear();
        await API.loadSheetRows(activeSheetId);
        closeGroupModal();
        renderSheetRows();
        showToast("Filas agrupadas");
    } catch (err) {
        console.error("Error al agrupar filas:", err);
        showToast("Error al agrupar filas");
    }
});

document.getElementById('moveForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!movingSheetRowId) return;
    const select = document.getElementById('move-target');
    const targetId = select?.value ? parseInt(select.value, 10) : null;

    try {
        const row = state.currentSheetRows.find(r => r.id === movingSheetRowId);
        if (!row) return;

        const previousParent = row.parent_id || null;
        const updated = { ...row, parent_id: targetId };

        await fetch(`/api/sheet-rows/${movingSheetRowId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated)
        });

        const idx = state.currentSheetRows.findIndex(r => r.id === movingSheetRowId);
        if (idx !== -1) state.currentSheetRows[idx] = updated;

        await API.loadSheetRows(activeSheetId);
        closeMoveModal();
        renderSheetRows();
        showToast("Fila movida");
    } catch (err) {
        console.error("Error al mover fila:", err);
        showToast("Error al mover fila");
    }
});

// Config & Settings
function renderConfigCategories() {
    const list = document.getElementById('config-categories-list');
    if (list) {
        list.innerHTML = '';
        state.categories.forEach(cat => {
            const div = document.createElement('div');
            div.className = "flex items-center justify-between p-2 bg-slate-50 rounded-lg group";
            div.innerHTML = `
                <span class="text-sm font-medium text-slate-700">${cat}</span>
                <button onclick="deleteCategory('${cat}')" class="text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    <i data-lucide="x" class="w-4 h-4"></i>
                </button>
            `;
            list.appendChild(div);
        });
    }

    // Update dropdowns
    const dropdowns = ['input-categoria'];
    dropdowns.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const currentVal = el.value;
            el.innerHTML = '';
            state.categories.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c;
                opt.textContent = c;
                el.appendChild(opt);
            });
            el.value = currentVal || state.categories[0];
        }
    });

    lucide.createIcons();
}

async function addCategory() {
    const input = document.getElementById('new-cat-name');
    const name = input.value.trim();
    if (!name || state.categories.includes(name)) return;

    state.categories.push(name);
    await API.saveCategories(state.categories);
    input.value = '';
    renderConfigCategories();
}

async function deleteCategory(name) {
    state.categories = state.categories.filter(c => c !== name);
    await API.saveCategories(state.categories);
    renderConfigCategories();
}

async function saveFixedCosts() {
    const costs = {
        payrollWeekly: parseFloat(document.getElementById('cfg-payroll').value) || 0,
        trucksMonthly: parseFloat(document.getElementById('cfg-trucks').value) || 0,
        servicesMonthly: parseFloat(document.getElementById('cfg-services').value) || 0,
        rentMonthly: parseFloat(document.getElementById('cfg-rent').value) || 0,
        taxesMonthly: parseFloat(document.getElementById('cfg-taxes').value) || 0
    };
    await API.saveFixedCosts(costs);
    showToast("Configuración guardada");
}

async function updateFixedCosts() {
    await saveFixedCosts();
    initCharts();
}

// Dashboard Charts
function buildMonthlySeries(range, transactions) {
    const labels = [];
    const incomeData = [];
    const expenseData = [];

    const monthlyIncome = new Map();
    const monthlyExpense = new Map();

    transactions.forEach((t) => {
        const key = (t.date || '').slice(0, 7);
        if (!key) return;
        if (t.type === 'ingreso') {
            monthlyIncome.set(key, (monthlyIncome.get(key) || 0) + t.amount);
        } else {
            monthlyExpense.set(key, (monthlyExpense.get(key) || 0) + t.amount);
        }
    });

    const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
    let endCursor = new Date(range.end.getFullYear(), range.end.getMonth(), 1);
    const monthsSpan = (endCursor.getFullYear() - cursor.getFullYear()) * 12 + (endCursor.getMonth() - cursor.getMonth()) + 1;
    if ((range.type === 'ytd' || range.type === 'q1') && monthsSpan < 4) {
        endCursor = new Date(cursor.getFullYear(), cursor.getMonth() + 3, 1);
    }

    while (cursor <= endCursor) {
        const yearMonth = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
        labels.push(cursor.toLocaleString('es-MX', { month: 'short' }).toUpperCase());
        incomeData.push(monthlyIncome.get(yearMonth) || 0);
        expenseData.push(monthlyExpense.get(yearMonth) || 0);
        cursor.setMonth(cursor.getMonth() + 1);
    }

    return { labels, incomeData, expenseData };
}

function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function buildWeeklySeries(range, transactions) {
    const labels = [];
    const incomeData = [];
    const expenseData = [];

    const weeklyIncome = new Map();
    const weeklyExpense = new Map();

    transactions.forEach((t) => {
        const weekStart = getWeekStart(parseTxDate(t.date));
        const key = weekStart.toISOString().slice(0, 10);
        if (t.type === 'ingreso') {
            weeklyIncome.set(key, (weeklyIncome.get(key) || 0) + t.amount);
        } else {
            weeklyExpense.set(key, (weeklyExpense.get(key) || 0) + t.amount);
        }
    });

    let cursor = getWeekStart(range.start);
    const end = getWeekStart(range.end);

    while (cursor <= end) {
        const key = cursor.toISOString().slice(0, 10);
        const label = `Sem ${String(cursor.getDate()).padStart(2, '0')}/${String(cursor.getMonth() + 1).padStart(2, '0')}`;
        labels.push(label);
        incomeData.push(weeklyIncome.get(key) || 0);
        expenseData.push(weeklyExpense.get(key) || 0);
        cursor = new Date(cursor);
        cursor.setDate(cursor.getDate() + 7);
    }

    return { labels, incomeData, expenseData };
}

function renderTopCategories(transactions, range) {
    const tbody = document.getElementById('top-categories-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const expenses = transactions.filter(t => t.type === 'egreso');
    const totals = new Map();
    expenses.forEach((t) => {
        const key = t.category || 'Sin categoria';
        totals.set(key, (totals.get(key) || 0) + t.amount);
    });

    const entries = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (entries.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="px-4 py-3 text-sm text-slate-400" colspan="4">Sin datos en el rango seleccionado.</td>
        `;
        tbody.appendChild(row);
        return;
    }
    const days = getDaysBetween(range.start, range.end);
    const monthlyFactor = days / 30.44;

    const monthlyBudget = {
        payroll: (state.fixedCosts.payrollWeekly || 0) * 4.33,
        taxes: state.fixedCosts.taxesMonthly || 0,
        trucks: state.fixedCosts.trucksMonthly || 0,
        rent: state.fixedCosts.rentMonthly || 0,
        services: state.fixedCosts.servicesMonthly || 0
    };

    const budgetForCategory = (category) => {
        const key = normalizeCategoryKey(category);
        if (key.includes('nomina') || key.includes('nmina')) return monthlyBudget.payroll * monthlyFactor;
        if (key.includes('impuesto')) return monthlyBudget.taxes * monthlyFactor;
        if (key.includes('vehicul') || key.includes('vehcul')) return monthlyBudget.trucks * monthlyFactor;
        if (key.includes('renta')) return monthlyBudget.rent * monthlyFactor;
        if (key.includes('servicio')) return monthlyBudget.services * monthlyFactor;
        return null;
    };

    entries.forEach(([category, actual]) => {
        const budget = budgetForCategory(category);
        const variance = budget !== null ? actual - budget : null;
        const variancePct = budget && budget > 0 ? (variance / budget) * 100 : null;

        const row = document.createElement('tr');
        row.className = "border-b last:border-b-0";
        row.innerHTML = `
            <td class="px-4 py-3 text-sm font-semibold text-slate-700">${category}</td>
            <td class="px-4 py-3 text-sm text-right font-bold text-slate-700">${formatCurrency(actual)}</td>
            <td class="px-4 py-3 text-sm text-right text-slate-500">${budget !== null ? formatCurrency(budget) : '-'}</td>
            <td class="px-4 py-3 text-sm text-right ${variance !== null ? (variance <= 0 ? 'text-emerald-600' : 'text-rose-600') : 'text-slate-400'}">
                ${variance !== null ? `${variance >= 0 ? '+' : '-'}${formatCurrency(Math.abs(variance))}` : '-'}
                ${variancePct !== null ? ` (${variancePct >= 0 ? '+' : ''}${variancePct.toFixed(1)}%)` : ''}
            </td>
        `;
        tbody.appendChild(row);
    });
}

function renderProjection(balance, weeklyNetAvg) {
    const list = document.getElementById('projection-list');
    const assumption = document.getElementById('projection-assumption');
    if (assumption) {
        assumption.textContent = `Promedio semanal: ${weeklyNetAvg >= 0 ? '+' : '-'}${formatCurrency(Math.abs(weeklyNetAvg))}`;
    }

    if (list) list.innerHTML = '';

    const labels = ['Actual'];
    const data = [balance];
    let current = balance;
    for (let i = 1; i <= 8; i++) {
        current += weeklyNetAvg;
        labels.push(`+${i} sem`);
        data.push(current);
        if (list) {
            const row = document.createElement('div');
            row.className = "flex justify-between text-sm py-1";
            row.innerHTML = `
                <span class="text-slate-500">Semana +${i}</span>
                <span class="font-bold ${current >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${formatCurrency(current)}</span>
            `;
            list.appendChild(row);
        }
    }

    const ctx = document.getElementById('projectionChart');
    if (!ctx) return;
    if (projectionChartInstance) projectionChartInstance.destroy();

    projectionChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Saldo proyectado',
                data,
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { ticks: { callback: (v) => formatCurrency(v) } }
            }
        }
    });
}

function initCharts() {
    const range = getDashboardRange();
    const rangeLabel = document.getElementById('dashboard-range-label');
    if (rangeLabel) rangeLabel.textContent = range.label;

    const view = document.getElementById('dashboard-view')?.value || 'monthly';

    const paidTx = state.transactions.filter(t => t.status === 'Pagado');
    const paidRange = paidTx.filter(t => isWithinRange(t.date, range));
    const pendingRange = state.transactions.filter(t => t.status !== 'Pagado' && isWithinRange(t.date, range));

    const weeklyFixed = state.fixedCosts.payrollWeekly +
        (state.fixedCosts.trucksMonthly +
            state.fixedCosts.servicesMonthly +
            state.fixedCosts.rentMonthly +
            state.fixedCosts.taxesMonthly) / 4.33;

    const monthlyFixed = state.fixedCosts.payrollWeekly * 4.33 +
        state.fixedCosts.trucksMonthly +
        state.fixedCosts.servicesMonthly +
        state.fixedCosts.rentMonthly +
        state.fixedCosts.taxesMonthly;

    const balance = paidTx.reduce((acc, t) => acc + (t.type === 'ingreso' ? t.amount : -t.amount), 0);

    const incomeRange = paidRange.filter(t => t.type === 'ingreso').reduce((acc, t) => acc + t.amount, 0);
    const expenseRange = paidRange.filter(t => t.type === 'egreso').reduce((acc, t) => acc + t.amount, 0);
    const marginRange = incomeRange > 0 ? ((incomeRange - expenseRange) / incomeRange * 100).toFixed(0) : 0;

    const pendingIncome = pendingRange.filter(t => t.type === 'ingreso').reduce((acc, t) => acc + t.amount, 0);
    const pendingExpense = pendingRange.filter(t => t.type === 'egreso').reduce((acc, t) => acc + t.amount, 0);
    const pendingServices = state.services
        .filter(s => (s.status || s.payment_status) !== 'pagado')
        .reduce((acc, s) => acc + (s.monthly_amount || 0), 0);

    const lastYearRange = {
        start: new Date(range.start),
        end: new Date(range.end)
    };
    lastYearRange.start.setFullYear(lastYearRange.start.getFullYear() - 1);
    lastYearRange.end.setFullYear(lastYearRange.end.getFullYear() - 1);

    const lastYearPaid = paidTx.filter(t => isWithinRange(t.date, lastYearRange));
    const lastYearIncome = lastYearPaid.filter(t => t.type === 'ingreso').reduce((acc, t) => acc + t.amount, 0);
    const lastYearExpense = lastYearPaid.filter(t => t.type === 'egreso').reduce((acc, t) => acc + t.amount, 0);
    const lastYearMargin = lastYearIncome > 0 ? ((lastYearIncome - lastYearExpense) / lastYearIncome * 100) : 0;

    const formatDelta = (current, prev) => {
        if (prev <= 0) return '-';
        const pct = ((current - prev) / prev) * 100;
        return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs ${range.start.getFullYear() - 1}`;
    };

    if (document.getElementById('kpi-ytd-income')) document.getElementById('kpi-ytd-income').textContent = formatCurrency(incomeRange);
    if (document.getElementById('kpi-ytd-expense')) document.getElementById('kpi-ytd-expense').textContent = formatCurrency(expenseRange);
    if (document.getElementById('kpi-ytd-margin')) document.getElementById('kpi-ytd-margin').textContent = `${marginRange}%`;

    if (document.getElementById('kpi-yoy-income')) document.getElementById('kpi-yoy-income').textContent = formatDelta(incomeRange, lastYearIncome);
    if (document.getElementById('kpi-yoy-expense')) document.getElementById('kpi-yoy-expense').textContent = formatDelta(expenseRange, lastYearExpense);
    if (document.getElementById('kpi-yoy-margin')) document.getElementById('kpi-yoy-margin').textContent = formatDelta(parseFloat(marginRange), lastYearMargin);

    if (document.getElementById('kpi-pending-income')) document.getElementById('kpi-pending-income').textContent = formatCurrency(pendingIncome);
    if (document.getElementById('kpi-pending-expense')) document.getElementById('kpi-pending-expense').textContent = formatCurrency(pendingExpense);
    if (document.getElementById('kpi-pending-services')) document.getElementById('kpi-pending-services').textContent = formatCurrency(pendingServices);

    // Update Overview
    const runwayEl = document.getElementById('kpi-runway-weeks');
    if (runwayEl) {
        const weeks = weeklyFixed > 0 ? (balance / weeklyFixed).toFixed(1) : 'N/A';
        runwayEl.textContent = `${weeks} Semanas`;
    }

    if (document.getElementById('kpi-balance')) document.getElementById('kpi-balance').textContent = formatCurrency(balance);
    if (document.getElementById('kpi-weekly-burn')) document.getElementById('kpi-weekly-burn').textContent = formatCurrency(weeklyFixed);
    if (document.getElementById('kpi-fixed-monthly')) document.getElementById('kpi-fixed-monthly').textContent = formatCurrency(monthlyFixed);
    if (document.getElementById('kpi-safety-margin')) document.getElementById('kpi-safety-margin').textContent = `${marginRange}%`;

    // Labels
    if (document.getElementById('label-payroll')) document.getElementById('label-payroll').textContent = formatCurrency(state.fixedCosts.payrollWeekly);
    if (document.getElementById('label-taxes')) document.getElementById('label-taxes').textContent = formatCurrency(state.fixedCosts.taxesMonthly);

    // Solvent Status + Alerts
    const statusBadge = document.getElementById('solvency-status-badge');
    const statusDesc = document.getElementById('solvency-desc');
    const weeks = weeklyFixed > 0 ? balance / weeklyFixed : 999;
    const alertEl = document.getElementById('runway-alert');

    if (alertEl) {
        if (weeks < 4) {
            alertEl.classList.remove('hidden');
            alertEl.textContent = weeks < 2
                ? 'Alerta: runway critico, menos de 2 semanas de cobertura.'
                : 'Alerta: runway bajo, menos de 4 semanas de cobertura.'
        } else {
            alertEl.classList.add('hidden');
        }
    }

    if (statusBadge && statusDesc) {
        if (weeks >= 4) {
            statusBadge.className = "mt-2 inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700";
            statusBadge.textContent = "Estado: Optimo";
            statusDesc.textContent = "Con el saldo actual cubres la operacion inmediata.";
        } else if (weeks >= 2) {
            statusBadge.className = "mt-2 inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700";
            statusBadge.textContent = "Estado: Precaucion";
            statusDesc.textContent = "Tu liquidez es baja, necesitas nuevos cobros pronto.";
        } else {
            statusBadge.className = "mt-2 inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-700";
            statusBadge.textContent = "Estado: Critico";
            statusDesc.textContent = "No tienes suficiente para cubrir los costos fijos.";
        }
    }

    // --- CHART: CASH FLOW ---
    const ctxBar = document.getElementById('barChart');
    if (ctxBar) {
        if (barChartInstance) barChartInstance.destroy();

        const series = view === 'weekly'
            ? buildWeeklySeries(range, paidRange)
            : buildMonthlySeries(range, paidRange);

        barChartInstance = new Chart(ctxBar, {
            type: 'bar',
            data: {
                labels: series.labels,
                datasets: [
                    {
                        label: 'Ingresos',
                        data: series.incomeData,
                        backgroundColor: '#10b981',
                        borderRadius: 6
                    },
                    {
                        label: 'Egresos',
                        data: series.expenseData,
                        backgroundColor: '#f43f5e',
                        borderRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' }
                },
                scales: {
                    y: {
                        ticks: {
                            callback: value => formatCurrency(value)
                        }
                    }
                }
            }
        });
    }

    // Top categories vs budget
    renderTopCategories(paidRange, range);

    // Projection
    const projectionWindow = 8;
    const endProjection = new Date();
    const startProjection = new Date();
    startProjection.setDate(endProjection.getDate() - (projectionWindow * 7) + 1);

    const weeklyNetMap = new Map();
    paidTx.forEach((t) => {
        if (!isWithinRange(t.date, { start: startProjection, end: endProjection })) return;
        const weekStart = getWeekStart(parseTxDate(t.date));
        const key = weekStart.toISOString().slice(0, 10);
        const delta = t.type === 'ingreso' ? t.amount : -t.amount;
        weeklyNetMap.set(key, (weeklyNetMap.get(key) || 0) + delta);
    });

    let netSum = 0;
    let cursor = getWeekStart(startProjection);
    for (let i = 0; i < projectionWindow; i++) {
        const key = cursor.toISOString().slice(0, 10);
        netSum += weeklyNetMap.get(key) || 0;
        cursor.setDate(cursor.getDate() + 7);
    }
    const weeklyNetAvg = netSum / projectionWindow;
    renderProjection(balance, weeklyNetAvg);

    const ctxPie = document.getElementById('fixedCostChart');
    if (ctxPie) {
        if (fixedCostChartInstance) fixedCostChartInstance.destroy();

        const data = [
            state.fixedCosts.payrollWeekly * 4.33,
            state.fixedCosts.taxesMonthly,
            state.fixedCosts.trucksMonthly,
            state.fixedCosts.rentMonthly,
            state.fixedCosts.servicesMonthly
        ];

        fixedCostChartInstance = new Chart(ctxPie, {
            type: 'doughnut',
            data: {
                labels: ['Nomina', 'Impuestos', 'Camionetas', 'Renta', 'Servicios'],
                datasets: [{
                    data: data,
                    backgroundColor: ['#6366f1', '#f43f5e', '#f59e0b', '#10b981', '#0ea5e9'],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                cutout: '70%'
            }
        });
    }
}

// Breakdown / Sheets
const sheetTemplates = {
    payroll: {
        label: 'Nomina semanal',
        group: { concept: 'Nomina', amount: 0, notes: 'Total de nomina' },
        rows: ['Empleado 1', 'Empleado 2', 'Empleado 3', 'Empleado 4']
    },
    fuel: {
        label: 'Gasolina semanal',
        group: { concept: 'Gasolina', amount: 0, notes: 'Total de gasolina' },
        rows: ['Carga 1', 'Carga 2', 'Carga 3']
    },
    maintenance: {
        label: 'Mantenimiento',
        group: { concept: 'Mantenimiento', amount: 0, notes: 'Total mantenimiento' },
        rows: ['Unidad 1', 'Unidad 2', 'Unidad 3']
    }
};

function parseDelimitedText(text) {
    const rows = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (rows.length === 0) return [];

    // Smart delimiter detection: count commas vs tabs in the first few lines
    let commaCount = 0;
    let tabCount = 0;
    const testLines = rows.slice(0, 5);
    testLines.forEach(line => {
        commaCount += (line.match(/,/g) || []).length;
        tabCount += (line.match(/\t/g) || []).length;
    });
    const delimiter = tabCount > commaCount ? '\t' : ',';

    const parsed = rows.map(line => {
        const cells = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === delimiter && !inQuotes) {
                cells.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
        cells.push(current);
        return cells.map(cell => cell.trim());
    });

    return parsed;
}

function mapImportedRows(parsed) {
    if (parsed.length === 0) return [];
    const headers = parsed[0].map(h => h.toLowerCase());
    const hasHeader = headers.includes('concepto') || headers.includes('concept') || headers.includes('monto') || headers.includes('amount');
    const startIndex = hasHeader ? 1 : 0;

    const rows = [];
    for (let i = startIndex; i < parsed.length; i++) {
        const row = parsed[i];
        if (row.length === 0) continue;

        let concept = row[0] || '';
        let amount = row[1] || '';
        let notes = row[2] || '';
        let group = '';

        if (hasHeader) {
            const getValue = (keys) => {
                const idx = headers.findIndex(h => keys.includes(h));
                return idx >= 0 ? (row[idx] || '') : '';
            };
            concept = getValue(['concepto', 'concept', 'nombre', 'name']);
            amount = getValue(['monto', 'amount', 'importe']);
            notes = getValue(['notas', 'notes', 'detalle', 'detalles']);
            group = getValue(['grupo', 'group', 'categoria', 'category']);
        }

        const amountValue = parseFloat(String(amount).replace(/[^\d.-]/g, ''));
        rows.push({
            concept: concept || 'Sin concepto',
            amount: isNaN(amountValue) ? 0 : amountValue,
            notes: notes || '',
            group: group || ''
        });
    }
    return rows;
}

async function importRows(rows) {
    if (!activeSheetId || rows.length === 0) return;

    const groupMap = new Map();
    for (const row of rows) {
        let parentId = null;
        if (row.group) {
            if (!groupMap.has(row.group)) {
                const parent = await API.addSheetRow({
                    sheet_id: activeSheetId,
                    concept: row.group,
                    amount: row.groupAmount ?? 0,
                    notes: 'Grupo'
                });
                groupMap.set(row.group, parent.id);
            }
            parentId = groupMap.get(row.group);
        }

        await API.addSheetRow({
            sheet_id: activeSheetId,
            concept: row.concept,
            amount: row.amount,
            notes: row.notes,
            parent_id: parentId
        });
    }

    await API.loadSheetRows(activeSheetId);
    renderSheetRows();
    showToast("Filas importadas");
}

async function applyTemplate() {
    if (!activeSheetId) {
        showToast("Selecciona una hoja primero");
        return;
    }

    const select = document.getElementById('template-select');
    const templateKey = select?.value || '';
    if (!templateKey || !sheetTemplates[templateKey]) return;

    const template = sheetTemplates[templateKey];
    try {
        let parentId = null;
        if (template.group) {
            const parent = await API.addSheetRow({
                sheet_id: activeSheetId,
                concept: template.group.concept,
                amount: template.group.amount || 0,
                notes: template.group.notes || ''
            });
            parentId = parent.id;
        }

        for (const rowName of template.rows) {
            await API.addSheetRow({
                sheet_id: activeSheetId,
                concept: rowName,
                amount: 0,
                notes: '',
                parent_id: parentId
            });
        }

        await API.loadSheetRows(activeSheetId);
        renderSheetRows();
        showToast("Plantilla aplicada");
    } catch (err) {
        console.error("Error al aplicar plantilla:", err);
        showToast("Error al aplicar plantilla");
    }
}

async function pasteRows() {
    if (!navigator.clipboard?.readText) {
        showToast("No se puede acceder al portapapeles");
        return;
    }
    try {
        const text = await navigator.clipboard.readText();
        const parsed = parseDelimitedText(text);
        const rows = mapImportedRows(parsed);
        await importRows(rows);
    } catch (err) {
        console.error("Error al pegar:", err);
        showToast("Error al pegar filas");
    }
}

function openCsvImport() {
    if (!activeSheetId) {
        showToast("Selecciona una hoja primero");
        return;
    }
    document.getElementById('csv-file')?.click();
}

async function handleCsvFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseDelimitedText(text);
    const rows = mapImportedRows(parsed);
    await importRows(rows);
    event.target.value = '';
}

function openIncomeCsvImport() {
    document.getElementById('income-csv-file')?.click();
}

async function handleIncomeCsvFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseDelimitedText(text);
    const rows = mapIncomeImportedRows(parsed);

    for (const tx of rows) {
        await API.addTransaction(tx);
    }

    await API.loadState();
    renderTable();
    initCharts();
    showToast(`${rows.length} ingresos importados`);
    event.target.value = '';
}

function mapIncomeImportedRows(parsed) {
    if (parsed.length === 0) return [];

    const headers = parsed[0].map(h => h.toLowerCase().trim());
    const getIndex = (keys) => {
        const exact = headers.findIndex(h => keys.some(k => h === k.toLowerCase()));
        if (exact >= 0) return exact;
        return headers.findIndex(h => keys.some(k => h.includes(k.toLowerCase())));
    };

    const idxDate = getIndex(['ingresos', 'fecha', 'date']);
    const idxConcept = getIndex(['concepto', 'concept']);
    const idxTotal = getIndex(['total', 'monto', 'amount', 'importe']);
    const idxIva = getIndex(['iva', 'tax']);
    const idxSubtotal = getIndex(['sub total', 'subtotal', 'sub-total']);

    const startIndex = 1; // Assume header
    const rows = [];

    for (let i = startIndex; i < parsed.length; i++) {
        const row = parsed[i];
        if (row.length < 2) continue;

        const amount = idxTotal >= 0 ? parseFloat(String(row[idxTotal]).replace(/[^\d.-]/g, '')) : 0;
        const iva = idxIva >= 0 ? parseFloat(String(row[idxIva]).replace(/[^\d.-]/g, '')) : 0;
        const subtotal = idxSubtotal >= 0 ? parseFloat(String(row[idxSubtotal]).replace(/[^\d.-]/g, '')) : 0;

        rows.push({
            date: idxDate >= 0 ? standardizeDate(row[idxDate]) : new Date().toISOString().split('T')[0],
            category: 'Ventas',
            concept: idxConcept >= 0 ? row[idxConcept] : 'Ingreso Importado',
            amount: isNaN(amount) ? 0 : amount,
            subtotal: isNaN(subtotal) ? 0 : subtotal,
            iva: isNaN(iva) ? 0 : iva,
            type: 'ingreso',
            status: 'Pagado'
        });
    }
    return rows;
}

function openExpenseCsvImport() {
    document.getElementById('expense-csv-file')?.click();
}

async function handleExpenseCsvFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseDelimitedText(text);
    const rows = mapExpenseImportedRows(parsed);

    for (const tx of rows) {
        await API.addTransaction(tx);
    }

    await API.loadState();
    renderTable();
    initCharts();
    showToast(`${rows.length} egresos importados`);
    event.target.value = '';
}

function mapExpenseImportedRows(parsed) {
    if (parsed.length === 0) return [];

    const headers = parsed[0].map(h => h.toLowerCase().trim());
    const getIndex = (keys) => {
        // Prioridad 1: Coincidencia exacta
        const exact = headers.findIndex(h => keys.some(k => h === k.toLowerCase()));
        if (exact >= 0) return exact;
        // Prioridad 2: Contiene la palabra
        return headers.findIndex(h => keys.some(k => h.includes(k.toLowerCase())));
    };

    const idxDate = getIndex(['egresos', 'fecha', 'date']);
    const idxCategory = getIndex(['categoria', 'category']);
    const idxConcept = getIndex(['concepto', 'concept']);
    // Quitamos 'egreso' para evitar conflicto con el header de fecha 'Egresos'
    const idxTotal = getIndex(['total', 'monto', 'amount', 'importe']);

    const isHeaderUnknown = idxDate === -1 && idxConcept === -1 && idxTotal === -1;
    const startIndex = (isHeaderUnknown || idxDate >= 0) ? 1 : 0;

    const rows = [];
    for (let i = startIndex; i < parsed.length; i++) {
        const row = parsed[i];
        if (row.length < 2) continue;

        let date, concept, amount, category;

        if (isHeaderUnknown && row.length >= 3) {
            date = standardizeDate(row[0]);
            concept = row[1];
            amount = parseFloat(String(row[2]).replace(/[^\d.-]/g, ''));
            category = 'Otros';
        } else {
            date = idxDate >= 0 ? standardizeDate(row[idxDate]) : new Date().toISOString().split('T')[0];
            concept = idxConcept >= 0 ? row[idxConcept] : 'Egreso Importado';
            amount = idxTotal >= 0 ? parseFloat(String(row[idxTotal]).replace(/[^\d.-]/g, '')) : 0;
            category = idxCategory >= 0 ? row[idxCategory] : 'Otros';
        }

        rows.push({
            date: date || new Date().toISOString().split('T')[0],
            category: category || 'Otros',
            concept: concept || 'Egreso Importado',
            amount: isNaN(amount) ? 0 : amount,
            type: 'egreso',
            status: 'Pagado'
        });
    }
    return rows;
}

function renderSheetsList() {
    const list = document.getElementById('sheets-list');
    if (!list) return;
    list.innerHTML = '';
    state.sheets.forEach(s => {
        const div = document.createElement('div');
        div.className = "p-3 hover:bg-slate-50 cursor-pointer border-b text-sm flex justify-between group";
        div.onclick = () => loadSheet(s.id);
        div.innerHTML = `
            <div class="font-medium text-slate-700">${s.title}</div>
            <button onclick="event.stopPropagation(); deleteSheet(${s.id})" class="text-rose-400 opacity-40 hover:opacity-100 transition-opacity">
                <i data-lucide="trash-2" class="w-3 h-3"></i>
            </button>
        `;
        list.appendChild(div);
    });
    lucide.createIcons();
}

function sortByOrder(a, b) {
    const aOrder = a.sort_order ?? a.id;
    const bOrder = b.sort_order ?? b.id;
    return aOrder - bOrder;
}

function ensureRowTableEvents() {
    const tbody = document.getElementById('rows-body');
    if (!tbody || tbody.dataset.bound === 'true') return;
    tbody.dataset.bound = 'true';
    tbody.addEventListener('dblclick', handleInlineEdit);
    tbody.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    tbody.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!draggingSheetRowId) return;
        moveSheetRow(draggingSheetRowId, null, null);
    });
}

async function saveSheetRow(updated) {
    await fetch(`/api/sheet-rows/${updated.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
    });
    const idx = state.currentSheetRows.findIndex(r => r.id === updated.id);
    if (idx !== -1) state.currentSheetRows[idx] = updated;
}

function handleInlineEdit(event) {
    const target = event.target.closest('[data-edit-field]');
    if (!target) return;

    const rowId = parseInt(target.dataset.rowId, 10);
    const field = target.dataset.editField;
    if (!rowId || !field) return;

    const row = state.currentSheetRows.find(r => r.id === rowId);
    if (!row) return;

    const input = document.createElement('input');
    input.type = field === 'amount' ? 'number' : 'text';
    input.step = field === 'amount' ? '0.01' : undefined;
    input.value = field === 'amount' ? String(row.amount ?? 0) : (row[field] || '');
    input.className = "w-full bg-white border border-blue-200 rounded px-2 py-1 text-sm";

    const cell = target.parentElement;
    if (!cell) return;
    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    const finish = async (commit) => {
        if (!commit) {
            renderSheetRows();
            return;
        }
        const value = input.value.trim();
        const updated = { ...row };
        if (field === 'amount') {
            const amountValue = parseFloat(value);
            if (isNaN(amountValue)) {
                renderSheetRows();
                return;
            }
            updated.amount = amountValue;
        } else {
            updated[field] = value;
        }
        await saveSheetRow(updated);
        await API.loadSheetRows(activeSheetId);
        renderSheetRows();
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            finish(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            finish(false);
        }
    });
    input.addEventListener('blur', () => finish(true));
}

async function duplicateSheetRow(rowId) {
    const row = state.currentSheetRows.find(r => r.id === rowId);
    if (!row) return;
    try {
        await API.addSheetRow({
            sheet_id: activeSheetId,
            concept: `${row.concept} (copia)`,
            amount: row.amount,
            notes: row.notes || '',
            parent_id: row.parent_id || null
        });
        await API.loadSheetRows(activeSheetId);
        renderSheetRows();
        showToast("Fila duplicada");
    } catch (err) {
        console.error("Error al duplicar fila:", err);
        showToast("Error al duplicar fila");
    }
}

async function moveSheetRow(rowId, newParentId, insertBeforeId) {
    const row = state.currentSheetRows.find(r => r.id === rowId);
    if (!row) return;

    const oldParent = row.parent_id || null;
    const descendants = getDescendantIds(rowId);
    if (newParentId && descendants.has(newParentId)) {
        showToast("No puedes mover una fila dentro de sus hijos");
        return;
    }

    const siblingsNew = state.currentSheetRows
        .filter(r => (r.parent_id || null) === newParentId && r.id !== rowId)
        .sort(sortByOrder);

    if (insertBeforeId) {
        const idx = siblingsNew.findIndex(r => r.id === insertBeforeId);
        if (idx >= 0) {
            siblingsNew.splice(idx, 0, row);
        } else {
            siblingsNew.push(row);
        }
    } else {
        siblingsNew.push(row);
    }

    row.parent_id = newParentId;

    const updates = new Map();
    siblingsNew.forEach((item, index) => {
        const desired = index + 1;
        if (item.sort_order !== desired || item.id === rowId || item.parent_id !== newParentId) {
            const updated = { ...item, sort_order: desired, parent_id: item.parent_id || null };
            updates.set(updated.id, updated);
        }
    });

    if (oldParent !== newParentId) {
        const siblingsOld = state.currentSheetRows
            .filter(r => (r.parent_id || null) === oldParent && r.id !== rowId)
            .sort(sortByOrder);
        siblingsOld.forEach((item, index) => {
            const desired = index + 1;
            if (item.sort_order !== desired) {
                updates.set(item.id, { ...item, sort_order: desired });
            }
        });
    }

    try {
        for (const updated of updates.values()) {
            await saveSheetRow(updated);
        }
        await API.loadSheetRows(activeSheetId);
        renderSheetRows();
    } catch (err) {
        console.error("Error al mover fila:", err);
        showToast("Error al mover fila");
    }
}

async function loadSheet(id) {
    activeSheetId = id;
    await API.loadSheetRows(id);
    const sheet = state.sheets.find(s => s.id === id);
    document.getElementById('sheet-title').textContent = sheet.title;
    document.getElementById('sheet-date').textContent = `Creada: ${sheet.created_at || 'Reciente'}`;

    document.getElementById('breakdown-empty').classList.add('hidden');
    document.getElementById('breakdown-content').classList.remove('hidden');

    currentSelection.clear();
    renderSheetRows();
}

function renderSheetRows() {
    const tbody = document.getElementById('rows-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Build tree
    const roots = state.currentSheetRows.filter(r => !r.parent_id).sort(sortByOrder);
    const children = state.currentSheetRows.filter(r => r.parent_id).sort(sortByOrder);

    let total = 0;
    roots.forEach(r => {
        const rowTotal = renderRowTree(tbody, r, children, 0);
        total += rowTotal;
    });

    document.getElementById('sheet-total').textContent = formatCurrency(total);

    // Show/hide group button
    const groupBtn = document.getElementById('btn-group-rows');
    if (groupBtn) {
        groupBtn.classList.toggle('hidden', currentSelection.size < 2);
    }

    ensureRowTableEvents();
}

function renderRowTree(container, row, allChildren, depth) {
    const myChildren = allChildren.filter(c => c.parent_id === row.id).sort(sortByOrder);
    const isExpanded = expandState[row.id] !== false;
    const hasChildren = myChildren.length > 0;
    const childrenSum = myChildren.reduce((acc, c) => acc + (c.amount || 0), 0);
    const diff = childrenSum - (row.amount || 0);
    const diffOk = Math.abs(diff) < 0.01;

    const tr = document.createElement('tr');
    tr.className = `group hover:bg-slate-50 transition-colors ${depth > 0 ? 'bg-slate-50/30' : ''}`;
    tr.dataset.rowId = row.id;
    tr.dataset.parentId = row.parent_id || '';

    tr.addEventListener('dragover', (e) => {
        e.preventDefault();
        tr.classList.add('drag-over');
    });
    tr.addEventListener('dragleave', () => tr.classList.remove('drag-over'));
    tr.addEventListener('drop', (e) => {
        e.preventDefault();
        tr.classList.remove('drag-over');
        if (!draggingSheetRowId || draggingSheetRowId === row.id) return;

        if (hasChildren) {
            moveSheetRow(draggingSheetRowId, row.id, null);
        } else {
            moveSheetRow(draggingSheetRowId, row.parent_id || null, row.id);
        }
    });

    tr.innerHTML = `
        <td class="px-6 py-3" style="padding-left: ${depth * 32 + 24}px">
            <div class="flex items-center gap-3">
                <span class="drag-handle text-slate-400" draggable="true" data-drag-id="${row.id}">
                    <i data-lucide="grip-vertical" class="w-4 h-4"></i>
                </span>
                <input type="checkbox" class="rounded border-slate-300" 
                       ${currentSelection.has(row.id) ? 'checked' : ''} 
                       onclick="toggleRowSelection(${row.id})">
                ${hasChildren ? `
                    <button onclick="toggleGroupExpand(${row.id})" class="p-1 hover:bg-slate-200 rounded text-slate-400">
                        <i data-lucide="${isExpanded ? 'chevron-down' : 'chevron-right'}" class="w-3 h-3"></i>
                    </button>
                ` : ''}
                <span class="${hasChildren ? 'font-bold text-slate-800' : 'text-slate-600'} editable" data-edit-field="concept" data-row-id="${row.id}">${row.concept}</span>
            </div>
        </td>
        <td class="px-6 py-3 text-right font-bold text-slate-700">
            <span class="editable" data-edit-field="amount" data-row-id="${row.id}">${formatCurrency(row.amount)}</span>
            ${hasChildren ? `
                <div class="text-[10px] font-bold ${diffOk ? 'text-emerald-600' : 'text-rose-600'}">
                    ${diffOk ? 'Cuadra' : `Dif ${diff >= 0 ? '+' : '-'}${formatCurrency(Math.abs(diff))}`}
                </div>
            ` : ''}
        </td>
        <td class="px-6 py-3 text-slate-400 text-xs italic editable" data-edit-field="notes" data-row-id="${row.id}">${row.notes || ''}</td>
        <td class="px-6 py-3 text-right">
            <button onclick="editSheetRow(${row.id})" class="text-blue-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-all mr-2" title="Editar">
                <i data-lucide="pencil" class="w-4 h-4"></i>
            </button>
            <button onclick="duplicateSheetRow(${row.id})" class="text-indigo-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-all mr-2" title="Duplicar">
                <i data-lucide="copy" class="w-4 h-4"></i>
            </button>
            <button onclick="openMoveModal(${row.id})" class="text-slate-400 hover:text-slate-700 opacity-0 group-hover:opacity-100 transition-all mr-2" title="Mover">
                <i data-lucide="arrow-left-right" class="w-4 h-4"></i>
            </button>
            ${hasChildren ? `
                <button onclick="ungroupRows(${row.id})" class="text-amber-500 hover:text-amber-700 opacity-0 group-hover:opacity-100 transition-all mr-2" title="Desagrupar">
                    <i data-lucide="unlink" class="w-4 h-4"></i>
                </button>
            ` : ''}
            <button onclick="deleteSheetRow(${row.id})" class="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all" title="Eliminar">
                <i data-lucide="x" class="w-4 h-4"></i>
            </button>
        </td>
    `;
    const dragHandle = tr.querySelector('[data-drag-id]');
    if (dragHandle) {
        dragHandle.addEventListener('dragstart', (e) => {
            draggingSheetRowId = row.id;
            e.dataTransfer?.setData('text/plain', String(row.id));
        });
        dragHandle.addEventListener('dragend', () => {
            draggingSheetRowId = null;
        });
    }
    container.appendChild(tr);

    if (hasChildren && isExpanded) {
        myChildren.forEach(c => {
            renderRowTree(container, c, allChildren, depth + 1);
        });
    }

    if (window.lucide) lucide.createIcons();
    return row.amount;
}

function toggleRowSelection(id) {
    if (currentSelection.has(id)) currentSelection.delete(id);
    else currentSelection.add(id);
    renderSheetRows();
}

function toggleGroupExpand(id) {
    expandState[id] = !(expandState[id] !== false);
    renderSheetRows();
}

async function ungroupRows(groupId) {
    const group = state.currentSheetRows.find(r => r.id === groupId);
    if (!group) return;
    const children = state.currentSheetRows.filter(r => r.parent_id === groupId);
    if (children.length === 0) return;

    if (!confirm("¿Desagrupar y eliminar el grupo?")) return;

    try {
        for (const child of children) {
            const updated = { ...child, parent_id: null };
            await fetch(`/api/sheet-rows/${child.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated)
            });
        }
        await API.deleteSheetRow(groupId);
        await API.loadSheetRows(activeSheetId);
        renderSheetRows();
        showToast("Grupo eliminado");
    } catch (err) {
        console.error("Error al desagrupar:", err);
        showToast("Error al desagrupar");
    }
}

function openSheetModal() {
    const modal = document.getElementById('sheet-modal');
    const titleInput = document.getElementById('new-sheet-title');
    if (titleInput) titleInput.value = '';
    modal?.classList.remove('hidden');
}

function closeSheetModal() {
    document.getElementById('sheet-modal')?.classList.add('hidden');
}

function createNewSheet() {
    openSheetModal();
}

async function deleteSheet(id) {
    try {
        if (confirm("¿Eliminar esta hoja y todos sus conceptos?")) {
            await API.deleteSheet(id);
            if (activeSheetId === id) {
                activeSheetId = null;
                document.getElementById('breakdown-content').classList.add('hidden');
                document.getElementById('breakdown-empty').classList.remove('hidden');
            }
            renderSheetsList();
            showToast("Hoja eliminada");
        }
    } catch (e) {
        console.error("Error al eliminar hoja:", e);
        showToast("Error al eliminar la hoja");
    }
}

function openSheetRowModal() {
    if (!activeSheetId) {
        showToast("Selecciona una hoja primero");
        return;
    }

    editingSheetRowId = null;
    const modal = document.getElementById('sheet-row-modal');
    const title = document.getElementById('sheet-row-modal-title');
    const conceptInput = document.getElementById('new-row-concept');
    const amountInput = document.getElementById('new-row-amount');
    const notesInput = document.getElementById('new-row-notes');

    if (title) title.textContent = 'Añadir Fila';
    if (conceptInput) conceptInput.value = '';
    if (amountInput) amountInput.value = '';
    if (notesInput) notesInput.value = '';
    if (amountInput) amountInput.disabled = false;

    modal?.classList.remove('hidden');
}

function closeSheetRowModal() {
    editingSheetRowId = null;
    document.getElementById('sheet-row-modal')?.classList.add('hidden');
}

function editSheetRow(id) {
    const row = state.currentSheetRows.find(r => r.id === id);
    if (!row) return;
    editingSheetRowId = id;

    const modal = document.getElementById('sheet-row-modal');
    const title = document.getElementById('sheet-row-modal-title');
    const conceptInput = document.getElementById('new-row-concept');
    const amountInput = document.getElementById('new-row-amount');
    const notesInput = document.getElementById('new-row-notes');
    if (title) title.textContent = 'Editar Fila';
    if (conceptInput) conceptInput.value = row.concept || '';
    if (amountInput) amountInput.value = row.amount ?? '';
    if (notesInput) notesInput.value = row.notes || '';

    modal?.classList.remove('hidden');
}

function openGroupModal() {
    if (currentSelection.size < 2) {
        showToast("Selecciona al menos dos filas para agrupar");
        return;
    }

    const modal = document.getElementById('group-modal');
    const input = document.getElementById('group-name');
    if (input) input.value = '';
    modal?.classList.remove('hidden');
}

function closeGroupModal() {
    document.getElementById('group-modal')?.classList.add('hidden');
}

function getDescendantIds(rootId) {
    const descendants = new Set();
    const stack = [rootId];

    while (stack.length) {
        const current = stack.pop();
        state.currentSheetRows.forEach((row) => {
            if (row.parent_id === current) {
                descendants.add(row.id);
                stack.push(row.id);
            }
        });
    }

    return descendants;
}

function openMoveModal(rowId) {
    const row = state.currentSheetRows.find(r => r.id === rowId);
    if (!row) return;
    movingSheetRowId = rowId;

    const modal = document.getElementById('move-modal');
    const title = document.getElementById('move-modal-title');
    const select = document.getElementById('move-target');

    if (title) title.textContent = `Mover: ${row.concept}`;
    if (select) {
        select.innerHTML = '';

        const optionNone = document.createElement('option');
        optionNone.value = '';
        optionNone.textContent = 'Sin grupo';
        select.appendChild(optionNone);

        const descendants = getDescendantIds(rowId);
        const groups = state.currentSheetRows
            .filter(r => r.id !== rowId && !descendants.has(r.id))
            .sort(sortByOrder);

        groups.forEach((g) => {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.concept;
            select.appendChild(opt);
        });

        select.value = row.parent_id || '';
    }

    modal?.classList.remove('hidden');
}

function closeMoveModal() {
    movingSheetRowId = null;
    document.getElementById('move-modal')?.classList.add('hidden');
}

async function deleteSheetRow(id) {
    const row = state.currentSheetRows.find(r => r.id === id);
    if (!row) return;

    const descendants = Array.from(getDescendantIds(id));
    const hasChildren = descendants.length > 0;
    const message = hasChildren ? "Eliminar grupo y sus filas?" : "Eliminar fila?";

    if (!confirm(message)) return;

    try {
        if (hasChildren) {
            for (const childId of descendants) {
                await API.deleteSheetRow(childId);
            }
        }
        await API.deleteSheetRow(id);
        await API.loadSheetRows(activeSheetId);
        renderSheetRows();
    } catch (err) {
        console.error("Error al eliminar fila:", err);
        showToast("Error al eliminar fila");
    }
}

function groupSelectedRows() {
    openGroupModal();
}

// Final initialization
async function updateUI() {
    const success = await API.loadState();
    if (!success) return;

    // Sync config values
    if (document.getElementById('cfg-payroll')) document.getElementById('cfg-payroll').value = state.fixedCosts.payrollWeekly || 0;
    if (document.getElementById('cfg-trucks')) document.getElementById('cfg-trucks').value = state.fixedCosts.trucksMonthly || 0;
    if (document.getElementById('cfg-services')) document.getElementById('cfg-services').value = state.fixedCosts.servicesMonthly || 0;
    if (document.getElementById('cfg-rent')) document.getElementById('cfg-rent').value = state.fixedCosts.rentMonthly || 0;
    if (document.getElementById('cfg-taxes')) document.getElementById('cfg-taxes').value = state.fixedCosts.taxesMonthly || 0;

    if (document.getElementById('input-fecha')) document.getElementById('input-fecha').valueAsDate = new Date();

    renderTable();
    renderServices();
    renderConfigCategories();
    renderSheetsList();

    // Default to landing
    showTab('landing');

    document.getElementById('dashboard-range')?.addEventListener('change', initCharts);
    document.getElementById('dashboard-view')?.addEventListener('change', initCharts);
    document.getElementById('csv-file')?.addEventListener('change', handleCsvFile);
    document.getElementById('income-csv-file')?.addEventListener('change', handleIncomeCsvFile);
    document.getElementById('expense-csv-file')?.addEventListener('change', handleExpenseCsvFile);
    if (window.lucide) lucide.createIcons();
}

// DATE FILTER FUNCTIONS
function getWeekRange(offset = 0) {
    const today = new Date();
    const currentDay = today.getDay();
    const diff = currentDay === 0 ? -6 : 1 - currentDay; // Monday = 1

    const monday = new Date(today);
    monday.setDate(today.getDate() + diff + (offset * 7));
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    return { start: monday, end: sunday };
}

function filterThisWeek() {
    const range = getWeekRange(0);
    dateFilter.startDate = range.start;
    dateFilter.endDate = range.end;
    dateFilter.active = true;
    dateFilter.label = `Filtrando: Esta Semana (${range.start.toLocaleDateString('es-MX')} - ${range.end.toLocaleDateString('es-MX')})`;
    updateFilterButtonsUI('week');
    renderTable();
}

function filterLastWeek() {
    const range = getWeekRange(-1);
    dateFilter.startDate = range.start;
    dateFilter.endDate = range.end;
    dateFilter.active = true;
    dateFilter.label = `Filtrando: Semana Pasada (${range.start.toLocaleDateString('es-MX')} - ${range.end.toLocaleDateString('es-MX')})`;
    updateFilterButtonsUI('last-week');
    renderTable();
}

function filterThisMonth() {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    start.setHours(0, 0, 0, 0);

    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);

    dateFilter.startDate = start;
    dateFilter.endDate = end;
    dateFilter.active = true;
    dateFilter.label = `Filtrando: Este Mes (${start.toLocaleDateString('es-MX')} - ${end.toLocaleDateString('es-MX')})`;
    updateFilterButtonsUI('month');
    renderTable();
}

function applyCustomFilter() {
    const startInput = document.getElementById('filter-start');
    const endInput = document.getElementById('filter-end');

    if (!startInput.value || !endInput.value) {
        alert('Por favor selecciona ambas fechas');
        return;
    }

    const start = new Date(startInput.value);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endInput.value);
    end.setHours(23, 59, 59, 999);

    if (start > end) {
        alert('La fecha "Desde" debe ser anterior a la fecha "Hasta"');
        return;
    }

    dateFilter.startDate = start;
    dateFilter.endDate = end;
    dateFilter.active = true;
    dateFilter.label = `Filtrando: ${start.toLocaleDateString('es-MX')} - ${end.toLocaleDateString('es-MX')}`;
    updateFilterButtonsUI('custom');
    renderTable();
}

function clearDateFilter() {
    dateFilter.startDate = null;
    dateFilter.endDate = null;
    dateFilter.active = false;
    dateFilter.label = '';

    document.getElementById('filter-start').value = '';
    document.getElementById('filter-end').value = '';

    updateFilterButtonsUI('clear');
    renderTable();
}

function updateFilterButtonsUI(activeType) {
    const filters = {
        'week': 'btn-filter-week',
        'last-week': 'btn-filter-last-week',
        'month': 'btn-filter-month',
        'clear': 'btn-filter-clear'
    };

    Object.entries(filters).forEach(([type, id]) => {
        const btn = document.getElementById(id);
        if (!btn) return;

        if (type === activeType) {
            btn.className = "px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-lg text-xs transition-colors border border-blue-200";
        } else {
            const isClear = type === 'clear';
            const textClass = isClear ? 'text-slate-500' : 'text-slate-700';
            btn.className = `px-3 py-1.5 bg-slate-50 hover:bg-slate-100 ${textClass} font-bold rounded-lg text-xs transition-colors border border-slate-200`;
        }
    });
}

function updateFilteredSummary(transactions) {
    let fiscalIncome = 0;
    let fiscalExpense = 0;
    let fiscalSubtotal = 0;
    let fiscalIva = 0;
    let cashIncome = 0;
    let cashExpense = 0;

    transactions.forEach(t => {
        if (t.status !== 'Pagado') return;

        const isCash = isCashTransaction(t);
        if (t.type === 'ingreso') {
            if (isCash) {
                cashIncome += t.amount;
            } else {
                fiscalIncome += t.amount;
                fiscalSubtotal += (t.subtotal || 0);
                fiscalIva += (t.iva || 0);
            }
        } else if (t.type === 'egreso') {
            if (isCash) {
                cashExpense += t.amount;
            } else {
                fiscalExpense += t.amount;
            }
        }
    });

    const fiscalBalance = fiscalIncome - fiscalExpense;
    const cashBalance = cashIncome - cashExpense;

    const fiscalIncEl = document.getElementById('filtered-income');
    const fiscalExpEl = document.getElementById('filtered-expense');
    const fiscalSubEl = document.getElementById('filtered-subtotal');
    const fiscalIvaEl = document.getElementById('filtered-iva');
    const fiscalBalEl = document.getElementById('filtered-balance');
    const cashIncEl = document.getElementById('filtered-cash-income');
    const cashExpEl = document.getElementById('filtered-cash-expense');
    const cashBalEl = document.getElementById('filtered-cash-balance');

    if (fiscalIncEl) fiscalIncEl.textContent = formatCurrency(fiscalIncome);
    if (fiscalExpEl) fiscalExpEl.textContent = formatCurrency(fiscalExpense);
    if (fiscalSubEl) fiscalSubEl.textContent = formatCurrency(fiscalSubtotal);
    if (fiscalIvaEl) fiscalIvaEl.textContent = formatCurrency(fiscalIva);
    if (fiscalBalEl) {
        fiscalBalEl.textContent = formatCurrency(fiscalBalance);
        fiscalBalEl.className = `text-xl font-black ${fiscalBalance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;
    }
    if (cashIncEl) cashIncEl.textContent = formatCurrency(cashIncome);
    if (cashExpEl) cashExpEl.textContent = formatCurrency(cashExpense);
    if (cashBalEl) {
        cashBalEl.textContent = formatCurrency(cashBalance);
        cashBalEl.className = `text-xl font-black ${cashBalance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;
    }
}

function toggleServiceFields() { }

window.onload = updateUI;
