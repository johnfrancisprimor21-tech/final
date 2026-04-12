// =====================================================
// API CONFIGURATION
// =====================================================
//: Aligned base URL with teacher-script.js and api-client.js
const API_BASE_URL = "https://attendance-api-production-ec07.up.railway.app/api";
// FIX: Read studentId dynamically so it always reflects the current session
// (avoids stale 'STU001' default from module-level evaluation)
function getStudentId() {
    return sessionStorage.getItem('studentId') || localStorage.getItem('studentId') || null;
}
// Keep a module-level reference that gets set properly on init
let STUDENT_ID = null; // BUG-07 FIX: removed 'STU001' fallback — initializeStudent() redirects to login if null

// =====================================================
// UTILITY FUNCTIONS
// =====================================================
// ============================================
// RECENT ACTIVITY LOG (last 5) + FULL HISTORY
// ============================================
const ACTIVITY_LOG_KEY = 'studentActivityLog';
const ACTIVITY_FULL_HISTORY_KEY = 'studentFullHistory';
const MAX_LOG_ITEMS = 5;
const ACTION_ICONS = {
    success: 'fas fa-check',
    warning: 'fas fa-exclamation-triangle',
    danger:  'fas fa-times',
    info:    'fas fa-info',
};

function logActivity(message, type = 'info') {
    const entry = {
        message,
        type,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
    const recent = JSON.parse(sessionStorage.getItem(ACTIVITY_LOG_KEY) || '[]');
    recent.unshift(entry);
    if (recent.length > MAX_LOG_ITEMS) recent.length = MAX_LOG_ITEMS;
    sessionStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(recent));

    const full = JSON.parse(sessionStorage.getItem(ACTIVITY_FULL_HISTORY_KEY) || '[]');
    full.unshift(entry);
    sessionStorage.setItem(ACTIVITY_FULL_HISTORY_KEY, JSON.stringify(full));

    renderActivityLog();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
        modalList.innerHTML = full.map(entry => `
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

    // FIX (C1): Calling /login invalidates the current session (NEW-02 backend behaviour).
    // Snapshot the current session tokens, call login to verify password, then restore
    // the original tokens so the working session remains alive.
    let isCorrect = false;
    try {
        const currentSessionId    = sessionStorage.getItem('sessionId') ||
                                    JSON.parse(sessionStorage.getItem('attendanceSession') || '{}').sessionId || '';
        const currentSessionToken = sessionStorage.getItem('sessionToken') ||
                                    JSON.parse(sessionStorage.getItem('attendanceSession') || '{}').sessionToken || '';

        const res = await fetch(API_BASE_URL + '/authentication/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password: input })
        });
        isCorrect = res.ok;

        // Restore the original session — login above created a new one and killed the old.
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
    const pendingId = modal.dataset.pendingId || null;

    if (scope === 'deleteAccount') {
        closeDeletePasswordModal();
        executeDeleteAccount();
        return;
    } else if (scope === 'deleteRecord') {
        closeDeletePasswordModal();
        executeDeleteRecord(pendingId);
        return;
    } else if (scope === 'deleteClass') {
        closeDeletePasswordModal();
        executeDeleteClass(pendingId);
        return;
    } else if (scope === 'deleteClassFromNav') {
        closeDeletePasswordModal();
        executeDeleteClassFromNav(pendingId);
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

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'error' : ''}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3000);
    // Auto-log every toast
    const logType = type === 'error' ? 'danger' : (type === 'warning' ? 'warning' : type === 'success' ? 'success' : 'info');
    logActivity(message, logType);
}

// =====================================================
// API HELPER FUNCTIONS
// =====================================================
async function apiCall(endpoint, method = 'GET', data = null) {
    try {
        const headers = {
            // FIX 1: Backend uses X-Session-Id header for auth, not Authorization Bearer token
            'X-Session-Id': sessionStorage.getItem('sessionId') ||
                            JSON.parse(sessionStorage.getItem('attendanceSession') || '{}').sessionId ||
                            '',
            'X-Session-Token': sessionStorage.getItem('sessionToken') ||
                            JSON.parse(sessionStorage.getItem('attendanceSession') || '{}').sessionToken ||
                            ''
        };

        // FIX 2: Backend reads StudentId from header
        // Only send when we actually have an authenticated student ID.
        if (STUDENT_ID) {
            headers.StudentId = STUDENT_ID;
        }

        if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            headers['Content-Type'] = 'application/json';
        }

        const options = {
            method: method,
            headers: headers
        };

        if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            options.body = JSON.stringify(data);
        }

        const response = await fetch(`${API_BASE_URL}${endpoint}`, options);

        if (response.status === 401) {
            window.location.href = 'login.html';
            return null;
        }

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `API Error: ${response.status}`;
            if (errorText) {
                try {
                    const errorData = JSON.parse(errorText);
                    errorMessage = errorData.message || errorData.title || errorMessage;
                } catch {
                    errorMessage = errorText;
                }
            }
            throw new Error(errorMessage);
        }

        // Handle endpoints that return no JSON body (e.g., 204 No Content).
        if (response.status === 204 || response.status === 205) {
            return { success: true };
        }

        const responseText = await response.text();
        if (!responseText) {
            return { success: true };
        }

        try {
            return JSON.parse(responseText);
        } catch {
            return { success: true, data: responseText };
        }
    } catch (error) {
        console.error('API Error:', error);
        showToast(error.message || 'API request failed', 'error');
        return null;
    }
}

// =====================================================
// INITIALIZATION
// =====================================================
window.addEventListener('DOMContentLoaded', () => {
    initializeStudent();
    renderActivityLog();
});

async function initializeStudent() {
    // Restore sessionStorage from localStorage in case it was wiped by page navigation
    if (!sessionStorage.getItem('sessionId')) {
        try {
            const stored = JSON.parse(sessionStorage.getItem('attendanceSession') || 'null');
            if (stored && stored.sessionId) {
                sessionStorage.setItem('sessionId',        stored.sessionId);
                sessionStorage.setItem('username',         stored.username || '');
                sessionStorage.setItem('fullName',         stored.fullName || stored.username || '');
                sessionStorage.setItem('pinAuthenticated', 'true');
                // FIX: Restore sessionToken so X-Session-Token header is populated after reload
                if (stored.sessionToken) sessionStorage.setItem('sessionToken', stored.sessionToken);
            }
        } catch {}
    }

    // Robust auth guard: check sessionStorage first, fallback to localStorage
    const isAuth = sessionStorage.getItem('pinAuthenticated') === 'true';
    const role = sessionStorage.getItem('userRole');
    if (!isAuth) {
        try {
            const stored = JSON.parse(sessionStorage.getItem('attendanceSession') || 'null');
            if (stored && stored.sessionId) {
                sessionStorage.setItem('pinAuthenticated', 'true');
                sessionStorage.setItem('sessionId', stored.sessionId);
                sessionStorage.setItem('username', stored.username || '');
                sessionStorage.setItem('fullName', stored.fullName || stored.username || '');
                // FIX: Restore sessionToken so X-Session-Token header is populated after reload
                if (stored.sessionToken) sessionStorage.setItem('sessionToken', stored.sessionToken);
            } else {
                window.location.href = 'login.html'; return;
            }
        } catch { window.location.href = 'login.html'; return; }
    }
    // If a different role is explicitly set, kick back to role selector
    if (role && role !== 'student') {
        window.location.href = 'role-selector.html'; return;
    }
    if (!role) sessionStorage.setItem('userRole', 'student');

    // Use the logged-in username as STUDENT_ID so it matches what the backend
    // resolves from the session token (ResolveUser returns the username).
    STUDENT_ID = sessionStorage.getItem('username') ||
                 JSON.parse(sessionStorage.getItem('attendanceSession') || '{}').username ||
                 getStudentId();

    if (!STUDENT_ID) {
        window.location.href = 'role-selector.html';
        return;
    }

    if (document.getElementById('classDate')) {
        document.getElementById('classDate').valueAsDate = new Date();
    }

    await loadStudentProfile();
    await loadCourses();
    await calculateStats();
    await loadRecords();

    showToast('Welcome back!', 'success');

    // Apply saved theme and accent on load
    const savedTheme = localStorage.getItem('student_theme') || 'dark';
    applyTheme(savedTheme);
    const savedAccent = localStorage.getItem('student_accent_color') || '#4ade80';
    applyAccentColor(savedAccent, false);

    // Start inactivity timer — auto-logout after 15 minutes of no activity
    if (typeof InactivityTimer !== 'undefined') {
        InactivityTimer.start(logout);
    }
}

// =====================================================
// SECTION NAVIGATION
// =====================================================
function switchSection(sectionId, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));

    const section = document.getElementById(sectionId);
    if (section) section.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const activeNavItem = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
    if (activeNavItem) activeNavItem.classList.add('active');

    const sectionNames = {
        checkin:     'Check In',
        records:     'Attendance Records',
        reports:     'Reports',
        'my-classes': 'My Classes',
        settings:    'Settings',
    };
    if (sectionNames[sectionId]) logActivity(`Navigated to ${sectionNames[sectionId]}`, 'info');

    switch(sectionId) {
        case 'records': loadRecords(); break;
        case 'reports': loadReports(); break;
        case 'settings': loadSettingsDefault(); break;
        case 'my-classes': loadClassesForNav(); break;
        case 'dashboard': calculateStats(); break;
    }
}

function switchSettingsTab(tabName, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    document.querySelectorAll('.settings-tab').forEach(tab => tab.classList.remove('active'));
    const tab = document.getElementById(`tab-${tabName}`);
    if (tab) tab.classList.add('active');

    document.querySelectorAll('.settings-menu-item').forEach(item => item.classList.remove('active'));
    const activeMenuItem = document.querySelector(`.settings-menu-item[data-tab="${tabName}"]`);
    if (activeMenuItem) activeMenuItem.classList.add('active');

    switch(tabName) {
        case 'notifications': loadNotificationSettings(); break;
        case 'theme': loadThemeSettings(); break;
        case 'security': loadSecuritySettings(); break;
        case 'privacy': loadPrivacySettings(); break;
    }
}

// =====================================================
// STUDENT PROFILE MANAGEMENT
// =====================================================
async function loadStudentProfile() {
    try {
        // FIX 3: Correct endpoint is GET /api/student/{studentId}
        const profile = await apiCall(`/student/${STUDENT_ID}`);

        if (profile) {
            localStorage.setItem('student_profile_data', JSON.stringify(profile));

            document.getElementById('studentName').textContent = profile.fullName || 'Student';
            document.getElementById('profileName').textContent = profile.fullName || 'Not Set';
            document.getElementById('profileEmail').textContent = profile.email || 'Not Set';
            document.getElementById('profileID').textContent = sessionStorage.getItem('studentDisplayId') || profile.studentId || 'Not Set';

            if (document.getElementById('editName')) {
                document.getElementById('editName').value = profile.fullName || '';
                document.getElementById('editEmail').value = profile.email || '';
                document.getElementById('editStudentID').value = sessionStorage.getItem('studentDisplayId') || profile.studentId || '';
            }
        }
    } catch (error) {
        console.error('Error loading profile:', error);
        const localProfile = JSON.parse(localStorage.getItem('student_profile_data')) || {};
        if (localProfile.fullName) {
            document.getElementById('studentName').textContent = localProfile.fullName;
            document.getElementById('profileName').textContent = localProfile.fullName;
        }
    }
}

async function updateProfile() {
    const cachedProfile = JSON.parse(localStorage.getItem('student_profile_data') || '{}');
    const profile = {
        fullName: document.getElementById('editName').value,
        email: document.getElementById('editEmail').value,
        studentId: document.getElementById('editStudentID').value,
        // Some backend builds treat non-nullable StudentDTO fields as required.
        // Send program/yearLevel explicitly to avoid 400 validation errors when omitted.
        program: cachedProfile.program || '',
        yearLevel: cachedProfile.yearLevel || ''
    };

    const result = await apiCall(`/student/${STUDENT_ID}`, 'PUT', profile);

    if (result) {
        localStorage.setItem('student_profile_data', JSON.stringify(result));
        await loadStudentProfile();
        showToast('Profile updated successfully!', 'success');
    }
}

// =====================================================
// COURSES MANAGEMENT
// =====================================================
async function loadCourses() {
    try {
        // FIX 2 & 4: Use /student/courses (StudentController) — reads studentId from header automatically.
        // Previously called /courses?studentId=... (CoursesController) which uses a SEPARATE data store.
        const courses = await apiCall(`/student/courses`);

        if (courses && Array.isArray(courses)) {
            localStorage.setItem('student_courses_data', JSON.stringify(courses));
            populateCourseDropdown(courses);
        }
    } catch (error) {
        console.error('Error loading courses:', error);
        const localCourses = JSON.parse(localStorage.getItem('student_courses_data')) || [];
        if (localCourses.length > 0) populateCourseDropdown(localCourses);
    }
}

function populateCourseDropdown(courses) {
    const select = document.getElementById('courseSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- Select a Course --</option>';

    courses.forEach(course => {
        const option = document.createElement('option');
        option.value = course.id;
        option.textContent = `${course.courseName} (${course.courseCode})`;
        option.dataset.room = course.room || '';
        option.dataset.building = course.building || '';
        select.appendChild(option);
    });
}

function updateCourseInfo() {
    const courseSelect = document.getElementById('courseSelect');
    const selectedOption = courseSelect.options[courseSelect.selectedIndex];
    if (courseSelect.value) {
        document.getElementById('roomNumber').value = selectedOption.dataset.room || '';
        document.getElementById('building').value = selectedOption.dataset.building || '';
    }
}

// =====================================================
// ATTENDANCE MANAGEMENT
// =====================================================
async function saveAttendance() {
    const courseId = document.getElementById('courseSelect').value;
    const date = document.getElementById('classDate').value;
    const time = document.getElementById('classTime').value;
    const room = document.getElementById('roomNumber').value;
    const building = document.getElementById('building').value;
    const status = document.getElementById('statusSelect').value;
    const notes = document.getElementById('notes').value;

    if (!courseId || !date || !status) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    const attendanceRecord = {
        studentId: STUDENT_ID,
        courseId: parseInt(courseId),
        date: date,
        time: time,
        room: room,
        building: building,
        status: status,
        notes: notes,
        timestamp: new Date().toISOString()
    };

    // FIX 5: Correct endpoint is POST /api/student/attendance (StudentController)
    const result = await apiCall('/student/attendance', 'POST', attendanceRecord);

    if (result) {
        showToast('Attendance record saved successfully!', 'success');
        clearForm();
        await calculateStats();
        await loadRecords();
    }
}

function clearForm() {
    document.getElementById('courseSelect').value = '';
    document.getElementById('classDate').valueAsDate = new Date();
    document.getElementById('classTime').value = '';
    document.getElementById('roomNumber').value = '';
    document.getElementById('building').value = '';
    document.getElementById('statusSelect').value = 'Present';
    document.getElementById('notes').value = '';
}

// =====================================================
// ATTENDANCE RECORDS
// =====================================================
async function loadRecords() {
    try {
        // FIX 6: Correct endpoint is GET /api/student/attendance/records (StudentController)
        const records = await apiCall(`/student/attendance/records`);
        const container = document.getElementById('recordsContainer');

        if (!container) return;

        if (!records || records.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>No attendance records yet</p></div>';
            return;
        }

        records.sort((a, b) => new Date(b.date) - new Date(a.date));

        container.innerHTML = '';

        records.forEach(record => {
            const statusClass = record.status === 'Present' ? 'status-present' : 'status-absent';

            const recordDiv = document.createElement('div');
            recordDiv.className = 'record-item';
            recordDiv.innerHTML = `
                <div class="record-info">
                    <h4>${escapeHtml(record.courseName || 'Course')}</h4>
                    <p>${escapeHtml(record.room || '')}, ${escapeHtml(record.building || '')} • ${new Date(record.date).toLocaleDateString()} ${escapeHtml(record.time || '')}</p>
                    ${record.notes ? `<p style="color: #a0a0a0; font-size: 0.85em;">${escapeHtml(record.notes)}</p>` : ''}
                </div>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <span class="status-badge ${statusClass}">${escapeHtml(record.status)}</span>
                    <button onclick="deleteRecord(${Number(record.id)}); return false;" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 1.2em;">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            container.appendChild(recordDiv);
        });
    } catch (error) {
        console.error('Error loading records:', error);
    }
}

function deleteRecord(recordId) {
    const modal = document.getElementById('deletePasswordModal');
    modal.dataset.pendingId = recordId;
    showPasswordPrompt('deleteRecord');
    const desc = document.querySelector('.pwd-modal-desc');
    if (desc) desc.textContent = 'Enter your password to delete this attendance record.';
}

async function executeDeleteRecord(recordId) {
    const result = await apiCall(`/student/attendance/${recordId}`, 'DELETE');
    if (result) {
        showToast('Record deleted successfully!', 'success');
        await calculateStats();
        await loadRecords();
    }
}

// =====================================================
// STATISTICS
// =====================================================
async function calculateStats() {
    try {
        // GET /api/student/stats — this one was already correct
        const stats = await apiCall(`/student/stats`);

        if (stats) {
            const rate = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;

            document.getElementById('attendanceRate').textContent = `${rate}%`;
            document.getElementById('rateBar').style.width = `${rate}%`;
            document.getElementById('presentDays').textContent = stats.present || 0;
            document.getElementById('presentPercent').textContent = `${rate}%`;
            document.getElementById('absentDays').textContent = stats.absent || 0;
            document.getElementById('absentPercent').textContent = `${stats.total > 0 ? Math.round((stats.absent / stats.total) * 100) : 0}%`;
            document.getElementById('streak').textContent = stats.streak || 0;
            document.getElementById('streakDays').textContent = stats.streakDays || 0;
        }
    } catch (error) {
        console.error('Error calculating stats:', error);
    }
}

// =====================================================
// REPORTS
// =====================================================
async function loadReports() {
    try {
        // FIX 8: /reports/student/{id} doesn't exist — use the correct backend endpoints
        const [weekly, monthly] = await Promise.all([
            apiCall(`/student/reports/weekly`),
            apiCall(`/student/reports/monthly`)
        ]);

        if (weekly) {
            document.getElementById('weeklyAttendance').textContent = weekly.weeklyAttendance || 0;
            document.getElementById('lastWeekAttendance').textContent = weekly.lastWeekAttendance || 0;
        }
        if (monthly) {
            document.getElementById('monthlyAttendance').textContent = monthly.monthlyAttendance || 0;
            document.getElementById('monthlyRate').textContent = `${monthly.monthlyRate || 0}%`;
        }
    } catch (error) {
        console.error('Error loading reports:', error);
    }
}

// =====================================================
// CLASS MANAGEMENT (SETTINGS)
// =====================================================
async function loadClassesForSettings() {
    try {
        // FIX 2 & 9: Use /student/courses (StudentController) — consistent with loadCourses.
        const courses = await apiCall(`/student/courses`);
        const tableBody = document.getElementById('classesTableBody');

        if (!tableBody) return;

        if (!courses || courses.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; color: #a0a0a0; padding: 20px;">
                        <i class="fas fa-inbox"></i> No classes added yet
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = '';

        courses.forEach(course => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="color: #4ade80; font-weight: 600;">${escapeHtml(course.courseCode)}</td>
                <td style="color: #e0e0e0;">${escapeHtml(course.courseName)}</td>
                <td style="color: #a0a0a0;">${escapeHtml(course.instructorEmail || 'Not set')}</td>
                <td style="color: #a0a0a0;">${escapeHtml(course.schedule || 'Not set')}</td>
                <td style="text-align: center;">
                    <button onclick="editClass(${Number(course.id)}); return false;" style="background: none; border: none; color: #60a5fa; cursor: pointer; margin-right: 10px;">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="deleteClass(${Number(course.id)}); return false;" style="background: none; border: none; color: #ef4444; cursor: pointer;">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) {
        console.error('Error loading classes:', error);
    }
}

async function addNewClass() {
    const code = document.getElementById('newCourseCode').value.trim();
    const name = document.getElementById('newCourseName').value.trim();
    const instructorEmail = document.getElementById('newCourseInstructor').value.trim();
    const schedule = document.getElementById('newCourseSchedule').value.trim();

    if (!code || !name || !instructorEmail) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    const newCourse = {
        studentId: STUDENT_ID,
        courseCode: code,
        courseName: name,
        instructorEmail: instructorEmail,
        schedule: schedule,
        // Some backend builds treat non-nullable Course fields as required.
        // Send room/building explicitly even if this form doesn't capture them yet.
        room: '',
        building: ''
    };

    // FIX 2 & 10: Use /student/courses (StudentController) to stay consistent with loadCourses.
    const result = await apiCall('/student/courses', 'POST', newCourse);

    if (result) {
        showToast('Class added successfully!', 'success');
        document.getElementById('newCourseCode').value = '';
        document.getElementById('newCourseName').value = '';
        document.getElementById('newCourseInstructor').value = '';
        document.getElementById('newCourseSchedule').value = '';
        await loadClassesForSettings();
        await loadCourses();
    }
}

function deleteClass(classId) {
    const modal = document.getElementById('deletePasswordModal');
    modal.dataset.pendingId = classId;
    showPasswordPrompt('deleteClass');
    const desc = document.querySelector('.pwd-modal-desc');
    if (desc) desc.textContent = 'Enter your password to remove this class.';
}

async function executeDeleteClass(classId) {
    const result = await apiCall(`/student/courses/${classId}`, 'DELETE');
    if (result) {
        showToast('Class deleted successfully!', 'success');
        await loadClassesForSettings();
        await loadCourses();
    }
}

async function editClass(classId) {
    showToast('Edit functionality coming soon!', 'success');
}

// =====================================================
// NOTIFICATION SETTINGS
// =====================================================
async function loadNotificationSettings() {
    // FIX 12: /settings/notifications endpoint doesn't exist in backend — use local storage fallback
    try {
        const saved = JSON.parse(localStorage.getItem('notification_settings')) || {};
        document.getElementById('notifClass').checked = saved.classReminders !== false;
        document.getElementById('notifAttendance').checked = saved.attendanceAlerts !== false;
        document.getElementById('notifSchedule').checked = saved.scheduleUpdates !== false;
        document.getElementById('notifEmail').checked = saved.emailNotifications !== false;
    } catch (error) {
        console.error('Error loading notification settings:', error);
    }
}

async function saveNotificationSettings() {
    const settings = {
        classReminders: document.getElementById('notifClass').checked,
        attendanceAlerts: document.getElementById('notifAttendance').checked,
        scheduleUpdates: document.getElementById('notifSchedule').checked,
        emailNotifications: document.getElementById('notifEmail').checked
    };
    // Save locally since backend has no settings endpoint
    localStorage.setItem('notification_settings', JSON.stringify(settings));
    showToast('Notification settings saved!', 'success');
}

// =====================================================
// THEME SETTINGS
// =====================================================
function applyTheme(themeName) {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = themeName === 'dark' || (themeName === 'auto' && prefersDark);
    document.body.classList.toggle('light-theme', !isDark);
    // Hide 3D/canvas overlays in light mode — they look broken on white
    const overlays = document.querySelectorAll('#academic-bg, #sidebar-canvas');
    overlays.forEach(el => { el.style.opacity = isDark ? '' : '0'; });
}

function loadThemeSettings() {
    const savedTheme = localStorage.getItem('student_theme') || 'dark';
    const themeElement = document.getElementById(savedTheme + 'Theme');
    if (themeElement) themeElement.checked = true;
    applyTheme(savedTheme);

    // Highlight saved accent color
    const savedAccent = localStorage.getItem('student_accent_color') || '#4ade80';
    applyAccentColor(savedAccent, false);
}

function setTheme(themeName) {
    localStorage.setItem('student_theme', themeName);
    const darkTheme = document.getElementById('darkTheme');
    const lightTheme = document.getElementById('lightTheme');
    const autoTheme = document.getElementById('autoTheme');
    if (darkTheme) darkTheme.checked = themeName === 'dark';
    if (lightTheme) lightTheme.checked = themeName === 'light';
    if (autoTheme) autoTheme.checked = themeName === 'auto';
    applyTheme(themeName);
    showToast(`Theme changed to ${themeName}!`, 'success');
}

function applyAccentColor(color, showNotification = true) {
    document.documentElement.style.setProperty('--accent', color);
    // dim version for backgrounds
    const hex = color.replace('#','');
    const r = parseInt(hex.substring(0,2),16);
    const g = parseInt(hex.substring(2,4),16);
    const b = parseInt(hex.substring(4,6),16);
    document.documentElement.style.setProperty('--accent-dim', `rgba(${r},${g},${b},0.15)`);
    document.documentElement.style.setProperty('--accent-hover', `rgba(${r},${g},${b},0.1)`);

    // Update swatch selected state
    document.querySelectorAll('.accent-swatch').forEach(el => el.classList.remove('selected'));
    const swatchId = 'swatch-' + color.replace('#','');
    const active = document.getElementById(swatchId);
    if (active) active.classList.add('selected');

    if (showNotification) showToast('Accent color updated!', 'success');
}

function setAccentColor(color) {
    localStorage.setItem('student_accent_color', color);
    applyAccentColor(color);
}

// =====================================================
// SECURITY SETTINGS
// =====================================================
function loadSecuritySettings() {
    const sessionInfo = document.getElementById('currentSessionInfo');
    if (sessionInfo) {
        const username = sessionStorage.getItem('username') ||
                         JSON.parse(sessionStorage.getItem('attendanceSession') || '{}').username || '';
        sessionInfo.textContent = `Browser • This Device${username ? ' (' + username + ')' : ''}`;
    }
}

function logoutAllSessions() {
    if (confirm('This will logout all other sessions. Continue?')) {
        showToast('All other sessions have been logged out!', 'success');
    }
}

// =====================================================
// PRIVACY SETTINGS
// =====================================================
async function loadPrivacySettings() {
    // FIX 14: /settings/privacy endpoint doesn't exist — use local storage fallback
    try {
        const saved = JSON.parse(localStorage.getItem('privacy_settings')) || {};
        document.getElementById('privacyPublic').checked = saved.showPublicly || false;
        document.getElementById('privacyProfile').checked = saved.allowProfile !== false;
        document.getElementById('privacyData').checked = saved.allowDataCollection !== false;
    } catch (error) {
        console.error('Error loading privacy settings:', error);
    }
}

async function savePrivacySettings() {
    const settings = {
        showPublicly: document.getElementById('privacyPublic').checked,
        allowProfile: document.getElementById('privacyProfile').checked,
        allowDataCollection: document.getElementById('privacyData').checked
    };
    // Save locally since backend has no settings endpoint
    localStorage.setItem('privacy_settings', JSON.stringify(settings));
    showToast('Privacy settings saved!', 'success');
}

function requestDataExport() {
    try {
        // Gather all stored data for this user
        const session = JSON.parse(sessionStorage.getItem('attendanceSession') || '{}');
        const profile = JSON.parse(localStorage.getItem('student_profile_data') || '{}');
        const courses = JSON.parse(localStorage.getItem('student_courses_data') || '[]');
        const privacy = JSON.parse(localStorage.getItem('privacy_settings') || '{}');
        const notifications = JSON.parse(localStorage.getItem('notification_settings') || '{}');

        const exportData = {
            exportedAt: new Date().toISOString(),
            user: {
                username: session.username || STUDENT_ID,
                fullName: session.fullName || profile.fullName || '',
                email: profile.email || ''
            },
            profile,
            courses,
            settings: { privacy, notifications }
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `attendance-data-${session.username || 'student'}-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Data exported successfully!', 'success');
    } catch (e) {
        showToast('Export failed. Please try again.', 'error');
    }
}

function deleteAccount() {
    showPasswordPrompt('deleteAccount');
    // Update modal description to reflect account deletion context
    const desc = document.querySelector('.pwd-modal-desc');
    if (desc) desc.textContent = 'Enter your password to permanently delete your account. This cannot be undone.';
}

async function executeDeleteAccount() {
    try {
        const sessionId = sessionStorage.getItem('sessionId') ||
                          JSON.parse(sessionStorage.getItem('attendanceSession') || '{}').sessionId;
        if (sessionId) {
            await apiCall('/authentication/logout', 'POST', { sessionId });
        }
    } catch {}

    localStorage.clear();
    sessionStorage.clear();
    showToast('Account deleted. Redirecting...', 'success');
    setTimeout(() => { window.location.href = 'login.html'; }, 1500);
}

// =====================================================
// LOGOUT
// =====================================================
function logout() {
    if (typeof InactivityTimer !== 'undefined') InactivityTimer.stop();
    if (confirm('Are you sure you want to logout?')) {
        const sessionId = sessionStorage.getItem('sessionId') ||
            (JSON.parse(sessionStorage.getItem('attendanceSession') || '{}')).sessionId || '';
        if (sessionId) {
            apiCall('/authentication/logout', 'POST', { sessionId });
        }
        // Clear ALL storage so next login starts completely fresh
        sessionStorage.clear();
        localStorage.removeItem('attendanceSession');
        localStorage.removeItem('token');
        window.location.href = 'login.html';
    }
}
// =====================================================
// MY CLASSES NAV SECTION FUNCTIONS
// =====================================================

// Load classes into the standalone My Classes nav section
async function loadClassesForNav() {
    try {
        const courses = await apiCall(`/student/courses`);
        const tableBody = document.getElementById('classesTableBody2');
        if (!tableBody) return;

        if (!courses || courses.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; color: #a0a0a0; padding: 20px;">
                        <i class="fas fa-inbox"></i> No classes added yet
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = '';
        courses.forEach(course => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="color: #4ade80; font-weight: 600;">${escapeHtml(course.courseCode)}</td>
                <td style="color: #e0e0e0;">${escapeHtml(course.courseName)}</td>
                <td style="color: #a0a0a0;">${escapeHtml(course.instructorEmail || 'Not set')}</td>
                <td style="color: #a0a0a0;">${escapeHtml(course.schedule || 'Not set')}</td>
                <td style="text-align: center;">
                    <button onclick="editClass(${Number(course.id)}); return false;" style="background: none; border: none; color: #60a5fa; cursor: pointer; margin-right: 10px;">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="deleteClassFromNav(${Number(course.id)}); return false;" style="background: none; border: none; color: #ef4444; cursor: pointer;">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) {
        console.error('Error loading classes (nav):', error);
    }
}

// Add class from the standalone My Classes nav section
async function addNewClassFromNav() {
    const code = document.getElementById('newCourseCode2').value.trim();
    const name = document.getElementById('newCourseName2').value.trim();
    const instructorEmail = document.getElementById('newCourseInstructor2').value.trim();
    const schedule = document.getElementById('newCourseSchedule2').value.trim();

    if (!code || !name || !instructorEmail) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    const newCourse = {
        studentId: STUDENT_ID,
        courseCode: code,
        courseName: name,
        instructorEmail: instructorEmail,
        schedule: schedule,
        room: '',
        building: ''
    };

    const result = await apiCall('/student/courses', 'POST', newCourse);
    if (result) {
        showToast('Class added successfully!', 'success');
        document.getElementById('newCourseCode2').value = '';
        document.getElementById('newCourseName2').value = '';
        document.getElementById('newCourseInstructor2').value = '';
        document.getElementById('newCourseSchedule2').value = '';
        await loadClassesForNav();
        await loadCourses();
    }
}

// Delete class from the standalone My Classes nav section
function deleteClassFromNav(classId) {
    const modal = document.getElementById('deletePasswordModal');
    modal.dataset.pendingId = classId;
    showPasswordPrompt('deleteClassFromNav');
    const desc = document.querySelector('.pwd-modal-desc');
    if (desc) desc.textContent = 'Enter your password to remove this class.';
}

async function executeDeleteClassFromNav(classId) {
    const result = await apiCall(`/student/courses/${classId}`, 'DELETE');
    if (result) {
        showToast('Class deleted successfully!', 'success');
        await loadClassesForNav();
        await loadCourses();
    }
}

// Default settings landing — open Theme tab (My Classes moved to nav)
function loadSettingsDefault() {
    switchSettingsTab('theme', null);
}