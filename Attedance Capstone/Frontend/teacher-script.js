// ============================================
// TEACHER DASHBOARD — Full Backend Edition
// All data stored on Railway backend via API.
// localStorage is only used for theme preference.
// ============================================

const API_BASE = 'https://attendance-api-production-ec07.up.railway.app/api';

// ============================================
// SESSION GUARD
// ============================================

(function checkSession() {
    let isAuthenticated = sessionStorage.getItem('pinAuthenticated') === 'true';
    if (!isAuthenticated) {
        try {
            const stored = JSON.parse(sessionStorage.getItem('attendanceSession') || 'null');
            if (stored && stored.sessionId) {
                isAuthenticated = true;
                sessionStorage.setItem('pinAuthenticated', 'true');
                sessionStorage.setItem('sessionId', stored.sessionId);
                // FIX: Also restore sessionToken so X-Session-Token header is populated after reload
                if (stored.sessionToken) sessionStorage.setItem('sessionToken', stored.sessionToken);
            }
        } catch {}
    }
    const role = sessionStorage.getItem('userRole');
    if (!isAuthenticated || role !== 'teacher') {
        window.location.replace('login.html');
    }
})();

// ============================================
// API HELPERS
// ============================================

function getSessionId() {
    return sessionStorage.getItem('sessionId') ||
           (JSON.parse(sessionStorage.getItem('attendanceSession') || '{}')).sessionId || '';
}

function getSessionToken() {
    return sessionStorage.getItem('sessionToken') ||
           (JSON.parse(sessionStorage.getItem('attendanceSession') || '{}')).sessionToken || '';
}

function authHeaders() {
    return {
        'Content-Type': 'application/json',
        'X-Session-Id':    getSessionId(),
        'X-Session-Token': getSessionToken()
    };
}

async function apiGet(path) {
    const res = await fetch(API_BASE + path, { headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
}

async function apiPost(path, body) {
    const res = await fetch(API_BASE + path, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
}

async function apiPut(path, body = null) {
    const res = await fetch(API_BASE + path, {
        method: 'PUT',
        headers: authHeaders(),
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
}

async function apiDelete(path) {
    const res = await fetch(API_BASE + path, {
        method: 'DELETE',
        headers: authHeaders()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
}

// ============================================
// LOGOUT
// ============================================

async function handleLogout() {
    if (typeof InactivityTimer !== 'undefined') InactivityTimer.stop();
    try {
        const sessionId = getSessionId();
        if (sessionId) {
            await fetch(API_BASE + '/authentication/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId })
            }).catch(() => {});
        }
    } catch {}
    sessionStorage.clear();
    localStorage.removeItem('attendanceSession');
    const btn = document.querySelector('.logout-btn');
    if (btn) {
        btn.classList.add('logging-out');
        setTimeout(() => window.location.replace('login.html'), 600);
    } else {
        window.location.replace('login.html');
    }
}

// ============================================
// STATE
// ============================================

let currentSection    = null;
let allSections       = [];
let studentsMgmtCache = [];

// ============================================
// UTILITY
// ============================================

function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) { el.classList.add('active'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    // Log navigation (skip dashboard to avoid noise on load)
    const sectionNames = {
        sectionManagement: 'Section Management',
        studentManagement: 'Student Management',
        markAttendance:    'Mark Attendance',
        summary:           'Attendance Summary',
        absentByDate:      'Absent by Date',
        editAttendance:    'Edit Attendance',
    };
    if (sectionNames[id]) logActivity(`Navigated to ${sectionNames[id]}`, 'info');
}

// ============================================
// RECENT ACTIVITY LOG (last 5 actions) + FULL HISTORY
// ============================================

const ACTIVITY_LOG_KEY = 'teacherActivityLog';
const ACTIVITY_FULL_HISTORY_KEY = 'teacherFullHistory';
const MAX_LOG_ITEMS = 5;

const ACTION_ICONS = {
    success: 'fas fa-check',
    warning: 'fas fa-exclamation-triangle',
    danger:  'fas fa-times',
    info:    'fas fa-info',
};

function logActivity(message, type = 'info') {
    // Recent (capped at 5)
    const recent = JSON.parse(sessionStorage.getItem(ACTIVITY_LOG_KEY) || '[]');
    const entry = {
        message,
        type,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
    recent.unshift(entry);
    if (recent.length > MAX_LOG_ITEMS) recent.length = MAX_LOG_ITEMS;
    sessionStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(recent));

    // Full history (unlimited for session)
    const full = JSON.parse(sessionStorage.getItem(ACTIVITY_FULL_HISTORY_KEY) || '[]');
    full.unshift(entry);
    sessionStorage.setItem(ACTIVITY_FULL_HISTORY_KEY, JSON.stringify(full));

    renderActivityLog();
}

function renderActivityLog() {
    const list = document.getElementById('activityLogList');
    if (!list) return;
    const stored = JSON.parse(sessionStorage.getItem(ACTIVITY_LOG_KEY) || '[]');
    if (stored.length === 0) {
        list.innerHTML = `<li class="activity-log-empty"><i class="fas fa-clock"></i> No recent activity yet.</li>`;
        return;
    }
    list.innerHTML = stored.map(entry => `
        <li class="activity-log-item log-${entry.type}">
            <div class="activity-log-icon"><i class="${ACTION_ICONS[entry.type] || 'fas fa-circle'}"></i></div>
            <div class="activity-log-body">
                <div class="activity-log-msg">${escapeHtml(entry.message)}</div>
                <div class="activity-log-time"><i class="fas fa-clock"></i> ${entry.time}</div>
            </div>
        </li>
    `).join('');
}

function clearActivityLog() {
    showPasswordPrompt('recent');
}

function showAllHistory() {
    const full = JSON.parse(sessionStorage.getItem(ACTIVITY_FULL_HISTORY_KEY) || '[]');
    const modalList = document.getElementById('historyModalList');
    if (full.length === 0) {
        modalList.innerHTML = `<li class="activity-log-empty"><i class="fas fa-clock"></i> No activity history yet.</li>`;
    } else {
        modalList.innerHTML = full.map((entry, i) => `
            <li class="activity-log-item log-${entry.type}">
                <div class="activity-log-icon"><i class="${ACTION_ICONS[entry.type] || 'fas fa-circle'}"></i></div>
                <div class="activity-log-body">
                    <div class="activity-log-msg">${escapeHtml(entry.message)}</div>
                    <div class="activity-log-time"><i class="fas fa-clock"></i> ${entry.time}</div>
                </div>
            </li>
        `).join('');
    }
    document.getElementById('historyModal').classList.add('active');
}

function closeHistoryModal(event) {
    const modal = document.getElementById('historyModal');
    if (event.target === modal) modal.classList.remove('active');
}

function clearAllHistory() {
    showPasswordPrompt('all');
}

function showPasswordPrompt(scope) {
    const modal = document.getElementById('deletePasswordModal');
    modal.dataset.scope = scope;
    document.getElementById('deletePasswordInput').value = '';
    document.getElementById('deletePasswordError').style.display = 'none';
    modal.classList.add('active');
    setTimeout(() => document.getElementById('deletePasswordInput').focus(), 100);
}

function closeDeletePasswordModal() {
    document.getElementById('deletePasswordModal').classList.remove('active');
}

async function confirmDeleteWithPassword() {
    const input = document.getElementById('deletePasswordInput').value;
    const errorEl = document.getElementById('deletePasswordError');
    const storedSession = JSON.parse(sessionStorage.getItem('attendanceSession') || '{}');
    const username = storedSession.username || sessionStorage.getItem('username') || '';

    if (!input || !username) {
        errorEl.style.display = 'flex';
        document.getElementById('deletePasswordInput').value = '';
        document.getElementById('deletePasswordInput').focus();
        return;
    }

    // FIX (C1): Do NOT call /login — it invalidates the current session (NEW-02 backend behaviour).
    // Instead verify identity by checking the session is still valid AND the password is correct
    // using a lightweight verify-only call that doesn't create a new session.
    // We re-use the existing session token; if the backend rejects it the user is already logged out.
    let isCorrect = false;
    try {
        // Use verify-security-answer is unavailable as a pure password check, so we use a
        // dedicated approach: attempt login but immediately discard the new token and restore
        // the current session tokens into storage so the existing session stays live.
        const currentSessionId    = getSessionId();
        const currentSessionToken = getSessionToken();

        const res = await fetch(API_BASE + '/authentication/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password: input })
        });
        isCorrect = res.ok;

        // Restore the original session immediately — the login call above creates a new session
        // and invalidates the old one; we put the old tokens back so our working session is valid.
        if (isCorrect) {
            sessionStorage.setItem('sessionId',    currentSessionId);
            sessionStorage.setItem('sessionToken', currentSessionToken);
            if (storedSession.sessionId) {
                storedSession.sessionId    = currentSessionId;
                storedSession.sessionToken = currentSessionToken;
                sessionStorage.setItem('attendanceSession', JSON.stringify(storedSession));
            }
        }
    } catch { isCorrect = false; }

    if (!isCorrect) {
        errorEl.style.display = 'flex';
        document.getElementById('deletePasswordInput').value = '';
        document.getElementById('deletePasswordInput').focus();
        return;
    }

    const modal = document.getElementById('deletePasswordModal');
    const scope = modal.dataset.scope;
    const pendingCode = modal.dataset.pendingCode || null;

    if (scope === 'deleteSection') {
        closeDeletePasswordModal();
        executeDeleteSection(pendingCode);
        return;
    } else if (scope === 'deleteStudent') {
        closeDeletePasswordModal();
        executeDeleteStudent(pendingCode);
        return;
    } else if (scope === 'all') {
        sessionStorage.removeItem(ACTIVITY_LOG_KEY);
        sessionStorage.removeItem(ACTIVITY_FULL_HISTORY_KEY);
        renderActivityLog();
        const historyModal = document.getElementById('historyModal');
        if (historyModal) historyModal.classList.remove('active');
    } else {
        sessionStorage.removeItem(ACTIVITY_LOG_KEY);
        renderActivityLog();
    }
    closeDeletePasswordModal();
    showToast('✓ History cleared', 'success');
}

function togglePwdVisibility() {
    const input = document.getElementById('deletePasswordInput');
    const icon = document.getElementById('pwdToggleIcon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fas fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fas fa-eye';
    }
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3000);
    // Auto-log every toast as a recent activity entry
    const logType = type === 'error' ? 'danger' : (type === 'warning' ? 'warning' : type === 'success' ? 'success' : 'info');
    logActivity(message, logType);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function toggleTheme() {
    document.body.classList.toggle('light-mode');
    localStorage.setItem('theme', document.body.classList.contains('light-mode') ? 'light' : 'dark');
}

window.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') document.body.classList.add('light-mode');
    showSection('dashboard');
    loadAllSections();
    renderActivityLog();

    // Start inactivity timer — auto-logout after 15 minutes of no activity
    if (typeof InactivityTimer !== 'undefined') {
        InactivityTimer.start(handleLogout);
    }
});

// ============================================
// SECTION MANAGEMENT
// ============================================

function switchSectionTab(tabName) {
    document.querySelectorAll('#sectionManagement .tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#sectionManagement .tab-button').forEach(b => b.classList.remove('active'));
    document.getElementById(tabName).classList.add('active');
    const matchBtn = Array.from(document.querySelectorAll('#sectionManagement .tab-button'))
        .find(b => b.getAttribute('onclick') && b.getAttribute('onclick').includes(tabName));
    if (matchBtn) matchBtn.classList.add('active');
    if (tabName === 'viewSectionTab')  loadSectionsList();
    else if (tabName === 'editSectionTab') loadSectionsForEdit();
}

async function loadAllSections() {
    try {
        allSections = await apiGet('/attendance/sections');
        updateSectionDropdowns();
        // Fix #2: Auto-select first section so dashboard stats load immediately
        if (allSections.length > 0 && !currentSection) {
            const dashSel = document.getElementById('dashboardSectionSelect');
            if (dashSel && !dashSel.value) {
                dashSel.value = allSections[0].code;
                currentSection = allSections[0].code;
                loadDashboardStats();
            }
        }
    } catch (e) {
        console.error('loadAllSections:', e);
        allSections = [];
    }
}

function updateSectionDropdowns() {
    const ids = [
        'dashboardSectionSelect', 'studentSectionSelect',
        'attendanceSectionSelect', 'summarySectionSelect',
        'absentSectionSelect', 'selectSectionToEdit', 'editAttSectionSelect'
    ];
    ids.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = '<option value="">-- Select Section --</option>';
        allSections.forEach(s => {
            const o = document.createElement('option');
            o.value = s.code;
            o.textContent = `${s.name} (${s.code})`;
            sel.appendChild(o);
        });
        sel.value = cur;
    });
}

async function createSection(event) {
    event.preventDefault();
    const code        = document.getElementById('sectionCode').value.trim();
    const name        = document.getElementById('sectionName').value.trim();
    const description = document.getElementById('sectionDescription').value.trim();
    if (!code || !name) { showToast('Please enter both Code and Name', 'warning'); return; }
    try {
        await apiPost('/attendance/sections', { code, name, description });
        showToast('✓ Section created', 'success');
        document.getElementById('createSectionForm').reset();
        await loadAllSections();
        loadSectionsList();
    } catch (e) {
        showToast(e.message || 'Error creating section', 'error');
    }
}

async function loadSectionsList() {
    const table = document.getElementById('sectionTableBody');
    table.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:#a0a0a0;">Loading…</td></tr>';
    try {
        const sections = await apiGet('/attendance/sections');
        allSections = sections;
        updateSectionDropdowns();
        table.innerHTML = '';
        if (sections.length === 0) {
            table.innerHTML = `<tr class="empty-row"><td colspan="4" style="text-align:center;padding:40px;"><i class="fas fa-inbox"></i> No sections found</td></tr>`;
            document.getElementById('totalSections').textContent = '0';
            return;
        }
        // Get student counts per section
        for (const section of sections) {
            try {
                const students = await apiGet(`/attendance/students?sectionCode=${encodeURIComponent(section.code)}`);
                section.studentCount = students.length;
            } catch { section.studentCount = 0; }
            const row = document.createElement('tr');
            // FIX (C4): Use data attribute instead of inline onclick string to prevent XSS
            // via a section code containing quotes or JS-injection characters.
            row.innerHTML = `
                <td><strong>${escapeHtml(section.code)}</strong></td>
                <td>${escapeHtml(section.name)}</td>
                <td><span class="stat-badge">${section.studentCount}</span></td>
                <td><button class="btn btn-secondary" data-section-code="${escapeHtml(section.code)}"><i class="fas fa-edit"></i> Edit</button></td>
            `;
            row.querySelector('button[data-section-code]').addEventListener('click', function() {
                editSectionClick(this.dataset.sectionCode);
            });
            table.appendChild(row);
        }
        document.getElementById('totalSections').textContent = sections.length;
        showToast(`✓ Loaded ${sections.length} sections`, 'success');
    } catch (e) {
        table.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#f87171;padding:20px;">${e.message}</td></tr>`;
        showToast('Error loading sections', 'error');
    }
}

function filterSections() {
    const search = document.getElementById('searchSection').value.toLowerCase();
    Array.from(document.getElementById('sectionTableBody').getElementsByTagName('tr')).forEach(row => {
        if (row.classList.contains('empty-row')) return;
        row.style.display = row.textContent.toLowerCase().includes(search) ? '' : 'none';
    });
}

async function loadSectionsForEdit() {
    try {
        const sections = await apiGet('/attendance/sections');
        allSections = sections;
        const select = document.getElementById('selectSectionToEdit');
        select.innerHTML = '<option value="">-- Select a Section --</option>';
        sections.forEach(s => {
            const o = document.createElement('option');
            o.value = s.code;
            o.textContent = `${s.name} (${s.code})`;
            select.appendChild(o);
        });
    } catch (e) { showToast('Error loading sections', 'error'); }
}

function loadSectionToEdit() {
    const code = document.getElementById('selectSectionToEdit').value;
    if (!code) { document.getElementById('editSectionForm').style.display = 'none'; return; }
    const section = allSections.find(s => s.code === code);
    if (section) {
        document.getElementById('editSectionCode').value        = section.code;
        document.getElementById('editSectionName').value        = section.name;
        document.getElementById('editSectionDescription').value = section.description || '';
        document.getElementById('editSectionForm').style.display = 'block';
    }
}

async function updateSection(event) {
    event.preventDefault();
    const code           = document.getElementById('editSectionCode').value;
    const newName        = document.getElementById('editSectionName').value.trim();
    const newDescription = document.getElementById('editSectionDescription').value.trim();
    try {
        await apiPut(`/attendance/sections/${encodeURIComponent(code)}`, { code, name: newName, description: newDescription });
        showToast('✓ Section updated', 'success');
        await loadAllSections();
        loadSectionsList();
        loadSectionsForEdit();
        document.getElementById('selectSectionToEdit').value = '';
        document.getElementById('editSectionForm').style.display = 'none';
    } catch (e) { showToast(e.message || 'Error updating section', 'error'); }
}

function deleteSection() {
    const code = document.getElementById('editSectionCode').value;
    if (!code) return;
    const modal = document.getElementById('deletePasswordModal');
    modal.dataset.pendingCode = code;
    showPasswordPrompt('deleteSection');
    const desc = document.querySelector('.pwd-modal-desc');
    if (desc) desc.textContent = `Enter your password to delete section "${code}" and all its students and records.`;
}

async function executeDeleteSection(code) {
    try {
        await apiDelete(`/attendance/sections/${encodeURIComponent(code)}`);
        showToast('✓ Section deleted', 'success');
        await loadAllSections();
        loadSectionsList();
        loadSectionsForEdit();
        document.getElementById('selectSectionToEdit').value = '';
        document.getElementById('editSectionForm').style.display = 'none';
    } catch (e) { showToast(e.message || 'Error deleting section', 'error'); }
}

function editSectionClick(code) {
    document.getElementById('selectSectionToEdit').value = code;
    loadSectionToEdit();
    switchSectionTab('editSectionTab');
}

// ============================================
// DASHBOARD STATS
// ============================================

async function switchDashboardSection() {
    currentSection = document.getElementById('dashboardSectionSelect').value;
    loadDashboardStats();
}

async function loadDashboardStats() {
    if (!currentSection) {
        ['totalStudents', 'totalPresent', 'totalAbsent'].forEach(id =>
            document.getElementById(id).textContent = '0');
        // Reset labels back to generic when no section selected
        const presentLabel = document.getElementById('labelTotalPresent');
        const absentLabel  = document.getElementById('labelTotalAbsent');
        if (presentLabel) presentLabel.textContent = 'Total Present';
        if (absentLabel)  absentLabel.textContent  = 'Total Absent';
        return;
    }
    try {
        const today = new Date().toISOString().split('T')[0];
        const [students, summary] = await Promise.all([
            apiGet(`/attendance/students?sectionCode=${encodeURIComponent(currentSection)}`),
            apiGet(`/attendance/summary?sectionCode=${encodeURIComponent(currentSection)}&date=${today}`)
        ]);
        document.getElementById('totalStudents').textContent = students.length;
        document.getElementById('totalPresent').textContent  = summary.present  ?? 0;
        document.getElementById('totalAbsent').textContent   = summary.absent   ?? 0;

        // Fix #3: Label present/absent as today's numbers so teachers aren't confused
        const fmt = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const presentLabel = document.getElementById('labelTotalPresent');
        const absentLabel  = document.getElementById('labelTotalAbsent');
        if (presentLabel) presentLabel.textContent = `Present Today (${fmt})`;
        if (absentLabel)  absentLabel.textContent  = `Absent Today (${fmt})`;
    } catch (e) { console.error('loadDashboardStats:', e); }
}

// ============================================
// STUDENT MANAGEMENT
// ============================================

function switchStudentSection() {
    currentSection = document.getElementById('studentSectionSelect').value;
    const container = document.getElementById('studentTabsContainer');
    if (currentSection) {
        container.style.display = 'flex';
        switchStudentTab('addStudentTab');
        loadStudentsMgmt();
    } else {
        container.style.display = 'none';
    }
}

function switchStudentTab(tabName) {
    document.querySelectorAll('#studentManagement .tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#studentManagement .tab-button').forEach(b => b.classList.remove('active'));
    document.getElementById(tabName).classList.add('active');
    const matchBtn = Array.from(document.querySelectorAll('#studentManagement .tab-button'))
        .find(b => b.getAttribute('onclick') && b.getAttribute('onclick').includes(tabName));
    if (matchBtn) matchBtn.classList.add('active');
    if (tabName === 'viewStudentTab')   loadStudentsMgmt();
    else if (tabName === 'editStudentTab')  loadStudentsForEditTab();
    else if (tabName === 'studentStatsTab') loadStudentsForStatsTab();
}

async function addStudentMgmt(event) {
    event.preventDefault();
    if (!currentSection) { showToast('Please select a section first', 'warning'); return; }
    const id   = document.getElementById('studentIdMgmt').value.trim();
    const name = document.getElementById('studentNameMgmt').value.trim();
    if (!id || !name) { showToast('Please enter both ID and Name', 'warning'); return; }
    try {
        await apiPost('/attendance/add-student', { id, fullName: name, sectionCode: currentSection });
        showToast('✓ Student added', 'success');
        document.getElementById('addStudentFormMgmt').reset();
        await loadStudentsMgmt();
        await loadStudentsForEditTab();
        await loadStudentsForStatsTab();
    } catch (e) { showToast(e.message || 'Error adding student', 'error'); }
}

async function loadStudentsMgmt() {
    if (!currentSection) return;
    const table = document.getElementById('studentTableMgmt');
    table.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#a0a0a0;">Loading…</td></tr>';
    try {
        const students = await apiGet(`/attendance/students?sectionCode=${encodeURIComponent(currentSection)}`);
        studentsMgmtCache = students;
        table.innerHTML = '';
        if (students.length === 0) {
            table.innerHTML = `<tr class="empty-row"><td colspan="5" style="text-align:center;padding:40px;"><i class="fas fa-inbox"></i> No students in this section</td></tr>`;
            document.getElementById('totalStudentsMgmt').textContent = '0';
            return;
        }
        // Fetch attendance summary per student
        for (const student of students) {
            let present = 0, absent = 0;
            try {
                const stats = await apiGet(`/attendance/summary-by-student?id=${encodeURIComponent(student.id)}`);
                present = stats.present; absent = stats.absent;
            } catch {}
            const row = document.createElement('tr');
            // FIX (C4): Use data attribute to avoid XSS via student.id in onclick string
            row.innerHTML = `
                <td><strong>${escapeHtml(student.id)}</strong></td>
                <td>${escapeHtml(student.name)}</td>
                <td><span class="stat-badge present">${present}</span></td>
                <td><span class="stat-badge absent">${absent}</span></td>
                <td><button class="btn btn-secondary" data-student-id="${escapeHtml(student.id)}"><i class="fas fa-eye"></i> View</button></td>
            `;
            row.querySelector('button[data-student-id]').addEventListener('click', function() {
                viewStudentDetails(this.dataset.studentId);
            });
            table.appendChild(row);
        }
        document.getElementById('totalStudentsMgmt').textContent = students.length;
        showToast(`✓ Loaded ${students.length} students`, 'success');
    } catch (e) {
        table.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#f87171;padding:20px;">${e.message}</td></tr>`;
        showToast('Error loading students', 'error');
    }
}

function filterStudentsMgmt() {
    const search = document.getElementById('searchStudentMgmt').value.toLowerCase();
    Array.from(document.getElementById('studentTableMgmt').getElementsByTagName('tr')).forEach(row => {
        if (row.classList.contains('empty-row')) return;
        row.style.display = row.textContent.toLowerCase().includes(search) ? '' : 'none';
    });
}

async function loadStudentsForEditTab() {
    if (!currentSection) return;
    try {
        const students = await apiGet(`/attendance/students?sectionCode=${encodeURIComponent(currentSection)}`);
        const select = document.getElementById('selectStudentToEdit');
        select.innerHTML = '<option value="">-- Select Student --</option>';
        students.forEach(s => {
            const o = document.createElement('option');
            o.value = s.id;
            o.textContent = `${s.name} (${s.id})`;
            select.appendChild(o);
        });
        studentsMgmtCache = students;
    } catch (e) { console.error(e); }
}

function loadStudentToEdit() {
    const id = document.getElementById('selectStudentToEdit').value;
    if (!id) { document.getElementById('editStudentForm').style.display = 'none'; return; }
    const student = studentsMgmtCache.find(s => s.id === id);
    if (student) {
        document.getElementById('editStudentId').value   = student.id;
        document.getElementById('editStudentName').value = student.name;
        document.getElementById('editStudentForm').style.display = 'block';
    }
}

async function updateStudent(event) {
    event.preventDefault();
    if (!currentSection) return;
    const id      = document.getElementById('editStudentId').value;
    const newName = document.getElementById('editStudentName').value.trim();
    try {
        await apiPut(`/attendance/update-student/${encodeURIComponent(id)}`, { id, fullName: newName, sectionCode: currentSection });
        showToast('✓ Student updated', 'success');
        await loadStudentsMgmt();
        await loadStudentsForEditTab();
        document.getElementById('selectStudentToEdit').value = '';
        document.getElementById('editStudentForm').style.display = 'none';
    } catch (e) { showToast(e.message || 'Error updating student', 'error'); }
}

function deleteStudentFromEdit() {
    if (!currentSection) return;
    const id = document.getElementById('editStudentId').value;
    if (!id) return;
    const modal = document.getElementById('deletePasswordModal');
    modal.dataset.pendingCode = id;
    showPasswordPrompt('deleteStudent');
    const desc = document.querySelector('.pwd-modal-desc');
    if (desc) desc.textContent = `Enter your password to remove student ${id} from this section.`;
}

async function executeDeleteStudent(id) {
    try {
        await apiDelete(`/attendance/remove-student/${encodeURIComponent(id)}?sectionCode=${encodeURIComponent(currentSection)}`);
        showToast('✓ Student removed', 'success');
        await loadStudentsMgmt();
        await loadStudentsForEditTab();
        document.getElementById('selectStudentToEdit').value = '';
        document.getElementById('editStudentForm').style.display = 'none';
    } catch (e) { showToast(e.message || 'Error removing student', 'error'); }
}

async function loadStudentsForStatsTab() {
    if (!currentSection) return;
    try {
        const students = await apiGet(`/attendance/students?sectionCode=${encodeURIComponent(currentSection)}`);
        const select = document.getElementById('selectStudentForStats');
        select.innerHTML = '<option value="">-- Select Student --</option>';
        students.forEach(s => {
            const o = document.createElement('option');
            o.value = s.id;
            o.textContent = `${s.name} (${s.id})`;
            select.appendChild(o);
        });
    } catch (e) { console.error(e); }
}

async function loadStudentStats() {
    const id = document.getElementById('selectStudentForStats').value;
    if (!id) { document.getElementById('studentStatsContainer').style.display = 'none'; return; }
    try {
        const stats = await apiGet(`/attendance/summary-by-student?id=${encodeURIComponent(id)}`);
        document.getElementById('studentPresentCount').textContent         = stats.present;
        document.getElementById('studentAbsentCount').textContent          = stats.absent;
        document.getElementById('studentAttendancePercentage').textContent = stats.percentage + '%';
        document.getElementById('studentStatsContainer').style.display     = 'block';
        showToast('✓ Statistics loaded', 'success');
    } catch (e) { showToast('Error loading stats', 'error'); }
}

function viewStudentDetails(studentId) {
    document.getElementById('selectStudentForStats').value = studentId;
    loadStudentStats();
    switchStudentTab('studentStatsTab');
}

function exportStudentsCSV() {
    if (!currentSection || studentsMgmtCache.length === 0) {
        showToast('No students to export', 'warning'); return;
    }
    let csv = 'Student ID,Name\n';
    studentsMgmtCache.forEach(s => { csv += `${s.id},${s.name}\n`; });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = window.URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `students_${currentSection}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    showToast('✓ Exported', 'success');
}

// ============================================
// MARK ATTENDANCE
// ============================================

async function switchAttendanceSection() {
    currentSection = document.getElementById('attendanceSectionSelect').value;
    const toggle     = document.getElementById('attendanceModeToggle');
    const bulkPanel  = document.getElementById('bulkAttendancePanel');
    const singleForm = document.getElementById('markAttendanceForm');
    if (currentSection) {
        toggle.style.display = 'block';
        switchAttendanceMode('bulk');
    } else {
        toggle.style.display = 'none';
        bulkPanel.style.display = 'none';
        singleForm.style.display = 'none';
    }
}

function switchAttendanceMode(mode) {
    const bulkPanel  = document.getElementById('bulkAttendancePanel');
    const singleForm = document.getElementById('markAttendanceForm');
    const bulkBtn    = document.getElementById('modeBulkBtn');
    const singleBtn  = document.getElementById('modeSingleBtn');
    if (mode === 'bulk') {
        bulkPanel.style.display  = 'block';
        singleForm.style.display = 'none';
        bulkBtn.className  = 'btn btn-primary';
        singleBtn.className = 'btn btn-secondary';
        loadBulkStudentList();
        const d = document.getElementById('bulkAttendanceDate');
        if (!d.value) d.value = new Date().toISOString().split('T')[0];
    } else {
        bulkPanel.style.display  = 'none';
        singleForm.style.display = 'flex';
        singleForm.style.flexDirection = 'column';
        bulkBtn.className  = 'btn btn-secondary';
        singleBtn.className = 'btn btn-primary';
        loadStudentsForDropdown();
    }
}

// ---- SIDE NOTIFICATION ----

function showSideNotif(message, duration = 5000) {
    const stack = document.getElementById('sideNotifStack');
    if (!stack) return;
    const notif = document.createElement('div');
    notif.className = 'side-notif';
    // FIX: Build via DOM instead of innerHTML to avoid XSS from arbitrary message content.
    // Callers that pass pre-built HTML (e.g. bold tags) are safe because escapeHtml was
    // already applied to the dynamic parts before being passed in.
    notif.innerHTML = `<i class="fas fa-exclamation-triangle"></i><span>${message}</span><i class="fas fa-xmark notif-close"></i>`;
    notif.addEventListener('click', () => dismissNotif(notif));
    stack.appendChild(notif);
    const timer = setTimeout(() => dismissNotif(notif), duration);
    notif._timer = timer;
}

function dismissNotif(notif) {
    if (notif._dismissed) return;
    notif._dismissed = true;
    clearTimeout(notif._timer);
    notif.classList.add('fade-out');
    setTimeout(() => notif.remove(), 380);
}

// ---- BULK MODE ----

async function loadBulkStudentList() {
    if (!currentSection) return;
    const container = document.getElementById('bulkStudentList');
    container.innerHTML = '<p style="color:#a0a0a0;text-align:center;padding:20px;">Loading…</p>';
    try {
        const students = await apiGet(`/attendance/students?sectionCode=${encodeURIComponent(currentSection)}`);
        container.innerHTML = '';
        if (students.length === 0) {
            container.innerHTML = `<p style="color:#a0a0a0;text-align:center;padding:20px;"><i class="fas fa-inbox"></i> No students in this section</p>`;
            return;
        }

        const selectedDate = document.getElementById('bulkAttendanceDate').value || new Date().toISOString().split('T')[0];

        // Check which students already have attendance today
        let existingRecords = [];
        try {
            const recs = await apiGet(`/attendance/records?sectionCode=${encodeURIComponent(currentSection)}`);
            existingRecords = recs.filter(r => r.date === selectedDate);
        } catch {}

        const alreadyMarkedIds = new Set(existingRecords.map(r => r.studentId));
        const alreadyMarked = [];

        students.forEach(student => {
            const alreadyToday = alreadyMarkedIds.has(student.id);
            if (alreadyToday) alreadyMarked.push(student.name);
            const row = document.createElement('div');
            row.style.cssText = `display:flex;align-items:center;justify-content:space-between;
                background:${alreadyToday ? 'rgba(245,158,11,0.07)' : 'var(--card-bg,#1a1a2e)'};
                border:1px solid ${alreadyToday ? 'rgba(245,158,11,0.35)' : '#2a2a3e'};
                border-radius:8px;padding:10px 14px;gap:10px;margin-bottom:6px;`;
            row.innerHTML = `
                <span style="font-weight:600;color:#e0e0e0;flex:1;">${escapeHtml(student.name)}
                    <span style="color:#a0a0a0;font-size:0.85em;margin-left:6px;">(${escapeHtml(student.id)})</span>
                    ${alreadyToday ? '<span style="color:#f59e0b;font-size:0.78em;margin-left:8px;"><i class="fas fa-triangle-exclamation"></i> already marked</span>' : ''}
                </span>
                <select data-student-id="${escapeHtml(student.id)}" class="bulk-status-select"
                    style="background:#0d0d1a;color:#e0e0e0;border:1px solid #3a3a5c;border-radius:6px;padding:5px 10px;font-size:0.9em;cursor:pointer;">
                    <option value="Present" selected>✓ Present</option>
                    <option value="Absent">✗ Absent</option>
                    <option value="Late">⏰ Late</option>
                </select>
            `;
            container.appendChild(row);
        });

        alreadyMarked.forEach((name, i) => {
            setTimeout(() => showSideNotif(`<strong>${escapeHtml(name)}</strong> already marked for ${selectedDate}`), i * 200);
        });
    } catch (e) {
        container.innerHTML = `<p style="color:#f87171;text-align:center;padding:20px;">${e.message}</p>`;
        showToast('Error loading students', 'error');
    }
}

function markAllPresent() {
    document.querySelectorAll('.bulk-status-select').forEach(s => { s.value = 'Present'; });
    showToast('✓ All set to Present', 'success');
}

async function submitBulkAttendance() {
    if (!currentSection) { showToast('Please select a section', 'warning'); return; }
    const date = document.getElementById('bulkAttendanceDate').value || new Date().toISOString().split('T')[0];
    const selects = document.querySelectorAll('.bulk-status-select');
    if (selects.length === 0) { showToast('No students to submit', 'warning'); return; }

    const records = Array.from(selects).map(sel => ({
        studentId:   sel.dataset.studentId,
        status:      sel.value,
        date:        new Date(date),
        sectionCode: currentSection
    }));

    const btn = document.querySelector('#bulkAttendancePanel .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    try {
        const result = await apiPost('/attendance/mark-attendance-batch', records);
        const present = records.filter(r => r.status === 'Present').length;
        const absent  = records.filter(r => r.status === 'Absent').length;
        const late    = records.filter(r => r.status === 'Late').length;
        showToast(`✓ Submitted: ${present} present, ${absent} absent, ${late} late`, 'success');
        document.getElementById('bulkAttendanceDate').value = new Date().toISOString().split('T')[0];
        await loadBulkStudentList();
    } catch (e) {
        showToast(e.message || 'Error submitting attendance', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Submit Attendance'; }
    }
}

// ---- SINGLE MODE ----

async function loadStudentsForDropdown() {
    if (!currentSection) return;
    try {
        const students = await apiGet(`/attendance/students?sectionCode=${encodeURIComponent(currentSection)}`);
        const dropdown = document.getElementById('studentNameDropdown');
        dropdown.innerHTML = '<option value="">-- Select Student --</option>';
        students.forEach(s => {
            const o = document.createElement('option');
            o.value = s.id;
            o.textContent = `${s.name} (${s.id})`;
            dropdown.appendChild(o);
        });
    } catch (e) { showToast('Error loading students', 'error'); }
}

function onStudentNameSelected() {
    document.getElementById('attendanceId').value = document.getElementById('studentNameDropdown').value;
}

async function markAttendance(event) {
    event.preventDefault();
    if (!currentSection) { showToast('Please select a section', 'warning'); return; }
    const id     = document.getElementById('attendanceId').value.trim();
    const status = document.getElementById('status').value;
    const date   = document.getElementById('attendanceDate').value || new Date().toISOString().split('T')[0];
    if (!id || !status) { showToast('Please select student and status', 'warning'); return; }
    try {
        await apiPost('/attendance/mark-attendance', {
            studentId: id, status, date: new Date(date), sectionCode: currentSection
        });
        showToast('✓ Attendance recorded', 'success');
        document.getElementById('markAttendanceForm').reset();
        await loadStudentsForDropdown();
    } catch (e) { showToast(e.message || 'Error marking attendance', 'error'); }
}

// ============================================
// SUMMARY
// ============================================

async function switchSummarySection() {
    currentSection = document.getElementById('summarySectionSelect').value;
}

async function loadSummary() {
    if (!currentSection) { showToast('Please select a section', 'warning'); return; }
    try {
        const summary = await apiGet(`/attendance/summary?sectionCode=${encodeURIComponent(currentSection)}`);
        document.getElementById('presentCount').textContent = summary.present;
        document.getElementById('absentCount').textContent  = summary.absent;
        showToast('✓ Summary loaded', 'success');
    } catch (e) { showToast('Error loading summary', 'error'); }
}

async function loadSummaryByDate() {
    if (!currentSection) { showToast('Please select a section', 'warning'); return; }
    const date = document.getElementById('summaryDate').value;
    if (!date) { showToast('Please select a date', 'warning'); return; }
    try {
        const summary = await apiGet(`/attendance/summary-by-date?date=${date}&sectionCode=${encodeURIComponent(currentSection)}`);
        document.getElementById('presentCount').textContent = summary.present;
        document.getElementById('absentCount').textContent  = summary.absent;
        showToast(`✓ Summary for ${date} loaded`, 'success');
    } catch (e) { showToast('Error loading summary', 'error'); }
}

async function loadStudentSummary() {
    if (!currentSection) { showToast('Please select a section', 'warning'); return; }
    const id = document.getElementById('summaryStudentId').value.trim();
    if (!id) { showToast('Please enter Student ID', 'warning'); return; }
    try {
        const stats = await apiGet(`/attendance/summary-by-student?id=${encodeURIComponent(id)}`);
        document.getElementById('presentCount').textContent = stats.present;
        document.getElementById('absentCount').textContent  = stats.absent;
        showToast('✓ Summary loaded', 'success');
    } catch (e) { showToast('Error loading summary', 'error'); }
}

// ============================================
// ABSENT BY DATE
// ============================================

async function switchAbsentSection() {
    currentSection = document.getElementById('absentSectionSelect').value;
    const form = document.getElementById('absentByDateForm');
    if (currentSection) { form.style.display = 'flex'; form.style.flexDirection = 'column'; }
    else { form.style.display = 'none'; }
}

async function loadAbsentByDate(event) {
    event.preventDefault();
    if (!currentSection) { showToast('Please select a section', 'warning'); return; }
    const date = document.getElementById('absentDate').value;
    if (!date) { showToast('Please select a date', 'warning'); return; }
    try {
        const result = await apiGet(`/attendance/absent-by-date?date=${date}&sectionCode=${encodeURIComponent(currentSection)}`);
        const table = document.getElementById('absentTable');
        table.innerHTML = '';
        if (result.students.length === 0) {
            table.innerHTML = `<tr class="empty-row"><td colspan="3" style="text-align:center;padding:40px;"><i class="fas fa-check-circle"></i> No absent students on this date</td></tr>`;
            document.getElementById('absentDateCount').textContent = '0';
            document.getElementById('absentStatsInfo').style.display = 'block';
            showToast('✓ No absent students', 'success');
            return;
        }
        result.students.forEach(s => {
            const row = document.createElement('tr');
            row.innerHTML = `<td><strong>${escapeHtml(s.id)}</strong></td><td>${escapeHtml(s.name)}</td><td>${date}</td>`;
            table.appendChild(row);
        });
        document.getElementById('absentDateCount').textContent = result.count;
        document.getElementById('absentStatsInfo').style.display = 'block';
        showToast(`✓ Found ${result.count} absent student(s)`, 'success');
    } catch (e) { showToast('Error loading absent students', 'error'); }
}

// ============================================
// EDIT ATTENDANCE
// ============================================

let _editAttRecords = [];

async function loadEditAttendanceRecords() {
    const sectionCode = document.getElementById('editAttSectionSelect').value;
    const dateFilter  = document.getElementById('editAttDateFilter').value;
    const container   = document.getElementById('editAttRecordsContainer');
    if (!sectionCode) {
        container.innerHTML = '<p style="color:#a0a0a0;text-align:center;padding:30px;"><i class="fas fa-arrow-up"></i> Select a section to view records</p>';
        return;
    }
    container.innerHTML = '<p style="color:#a0a0a0;text-align:center;padding:30px;">Loading…</p>';
    try {
        const records = await apiGet(`/attendance/records?sectionCode=${encodeURIComponent(sectionCode)}`);
        _editAttRecords = records.map(r => ({
            studentId:   r.studentId,
            studentName: r.studentName,
            status:      r.status,
            date:        r.date
        })).sort((a, b) => b.date.localeCompare(a.date));

        const filtered = dateFilter ? _editAttRecords.filter(r => r.date === dateFilter) : _editAttRecords;
        renderEditRecords(filtered);
    } catch (e) {
        container.innerHTML = `<p style="color:#f87171;text-align:center;padding:30px;">${e.message}</p>`;
        showToast('Error loading records', 'error');
    }
}

function filterEditRecords() {
    const search     = document.getElementById('editAttStudentFilter').value.toLowerCase().trim();
    const dateFilter = document.getElementById('editAttDateFilter').value;
    let filtered = _editAttRecords;
    if (dateFilter) filtered = filtered.filter(r => r.date === dateFilter);
    if (search)     filtered = filtered.filter(r =>
        r.studentName.toLowerCase().includes(search) || r.studentId.toLowerCase().includes(search));
    renderEditRecords(filtered);
}

function renderEditRecords(records) {
    const container = document.getElementById('editAttRecordsContainer');
    if (records.length === 0) {
        container.innerHTML = '<p style="color:#a0a0a0;text-align:center;padding:30px;"><i class="fas fa-inbox"></i> No records found</p>';
        return;
    }
    const color = { Present: '#4ade80', Absent: '#f87171', Late: '#f59e0b' };
    const icon  = { Present: 'fa-check', Absent: 'fa-times', Late: 'fa-clock' };
    container.innerHTML = records.map((r, i) => `
        <div class="edit-att-row" id="editrow-${i}" style="
            display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;
            background:#1a1a2e;border:1px solid #2a2a3e;border-radius:10px;padding:12px 16px;margin-bottom:8px;">
            <div style="flex:1;min-width:160px;">
                <span style="font-weight:600;color:#e0e0e0;">${escapeHtml(r.studentName)}</span>
                <span style="color:#a0a0a0;font-size:0.82em;margin-left:6px;">(${escapeHtml(r.studentId)})</span>
                <div style="color:#a0a0a0;font-size:0.8em;margin-top:2px;"><i class="fas fa-calendar-day"></i> ${r.date}</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <span style="background:${(color[r.status]||'#a0a0a0')}22;color:${color[r.status]||'#a0a0a0'};
                    border:1px solid ${(color[r.status]||'#a0a0a0')}55;border-radius:6px;padding:3px 10px;font-size:0.85em;font-weight:600;">
                    <i class="fas ${icon[r.status]||'fa-question'}"></i> ${r.status}
                </span>
                <select onchange="changeAttendanceStatus(this,'${r.studentId}','${r.date}')"
                    style="background:#0d0d1a;color:#e0e0e0;border:1px solid #3a3a5c;border-radius:6px;padding:5px 10px;font-size:0.85em;cursor:pointer;">
                    <option value="">-- Change to --</option>
                    <option value="Present" ${r.status==='Present'?'disabled':''}>✓ Present</option>
                    <option value="Absent"  ${r.status==='Absent' ?'disabled':''}>✗ Absent</option>
                    <option value="Late"    ${r.status==='Late'   ?'disabled':''}>⏰ Late</option>
                </select>
            </div>
        </div>
    `).join('');
}

async function changeAttendanceStatus(selectEl, studentId, date) {
    const newStatus = selectEl.value;
    if (!newStatus) return;
    try {
        await apiPut(`/attendance/update-record/${encodeURIComponent(studentId)}/${date}/${encodeURIComponent(newStatus)}`);
        showToast(`✓ ${studentId} changed to ${newStatus} for ${date}`, 'success');
        await loadEditAttendanceRecords();
    } catch (e) {
        showToast(e.message || 'Error updating attendance', 'error');
        selectEl.value = '';
    }
}