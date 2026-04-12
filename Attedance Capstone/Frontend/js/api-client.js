// ============================================
// API CLIENT — Username/Password Auth Version
// ============================================

class AttendanceAPI {
    constructor(baseURL = null) {
        this.baseURL      = baseURL || 'https://attendance-api-production-ec07.up.railway.app/api';
        this.sessionId    = null;
        this.sessionToken = null;
        this.userId       = null;
        this.isOnline     = true;
        this._connectivityChecked = false;
        this.checkConnectivity();
    }

    checkConnectivity() {
        fetch(this.baseURL + '/authentication/check-username/_ping_', { method: 'GET' })
            .then(() => { this.isOnline = true; })
            .catch(() => {
                this.isOnline = false;
                console.warn('⚠️ Backend offline — some features limited');
            })
            .finally(() => { this._connectivityChecked = true; });
    }

    // ============================================
    // AUTHENTICATION
    // ============================================

    async register(fullName, username, password, securityQuestion, securityAnswer) {
        const response = await fetch(`${this.baseURL}/authentication/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fullName, username, password, securityQuestion, securityAnswer })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Registration failed');
        return data;
    }

    async login(username, password) {
        const response = await fetch(`${this.baseURL}/authentication/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Login failed');

        this.sessionId    = data.sessionId;
        this.sessionToken = data.sessionToken;
        this.userId       = data.userId;

        localStorage.setItem('attendanceSession', JSON.stringify({
            sessionId:    this.sessionId,
            sessionToken: this.sessionToken,
            userId:       this.userId,
            username:     data.username,
            fullName:     data.fullName,
            loginTime:    data.loginTime
        }));

        return data;
    }

    async logout() {
        try {
            if (this.sessionId) {
                await fetch(`${this.baseURL}/authentication/logout`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: this.sessionId })
                });
            }
        } catch (e) {
            console.warn('Logout request failed (offline?):', e.message);
        } finally {
            localStorage.removeItem('attendanceSession');
            this.sessionId    = null;
            this.sessionToken = null;
            this.userId       = null;
        }
        return { message: 'Logged out successfully' };
    }

    async checkUsername(username) {
        const res = await fetch(`${this.baseURL}/authentication/check-username/${encodeURIComponent(username)}`);
        return res.json();
    }

    async getSecurityQuestion(username) {
        const res = await fetch(`${this.baseURL}/authentication/security-question/${encodeURIComponent(username)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'User not found');
        return data;
    }

    async verifySecurityAnswer(username, answer) {
        const res = await fetch(`${this.baseURL}/authentication/verify-security-answer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, answer })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Incorrect answer');
        return data;
    }

    async resetPassword(username, newPassword) {
        const res = await fetch(`${this.baseURL}/authentication/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, newPassword })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Reset failed');
        return data;
    }

    // ============================================
    // SESSION MANAGEMENT
    // ============================================

    restoreSession() {
        const raw = localStorage.getItem('attendanceSession');
        if (!raw) return false;
        try {
            const data = JSON.parse(raw);
            this.sessionId    = data.sessionId;
            this.sessionToken = data.sessionToken;
            this.userId       = data.userId;
            return true;
        } catch {
            return false;
        }
    }

    clearSession() {
        this.sessionId    = null;
        this.sessionToken = null;
        this.userId       = null;
        localStorage.removeItem('attendanceSession');
    }

    isSessionActive() {
        return !!this.sessionId && !!this.sessionToken;
    }

    getStoredSession() {
        try { return JSON.parse(localStorage.getItem('attendanceSession') || 'null'); }
        catch { return null; }
    }

    // ============================================
    // STUDENTS
    // ============================================

    async getStudents() {
        const response = await fetch(`${this.baseURL}/attendance/students`, {
            headers: { 'X-Session-Id': this.sessionId }
        });
        return response.json();
    }

    async addStudent(id, name) {
        const response = await fetch(`${this.baseURL}/attendance/add-student`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Id': this.sessionId
            },
            body: JSON.stringify({ id, name })
        });
        return response.json();
    }

    async removeStudent(id) {
        const response = await fetch(`${this.baseURL}/attendance/remove-student/${id}`, {
            method: 'DELETE',
            headers: { 'X-Session-Id': this.sessionId }
        });
        return response.json();
    }

    // ============================================
    // ATTENDANCE
    // ============================================

    async markAttendance(studentId, status, date = null) {
        const response = await fetch(`${this.baseURL}/attendance/mark-attendance`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Id': this.sessionId
            },
            body: JSON.stringify({ studentId, status, date })
        });
        return response.json();
    }

    async getSummary() {
        const response = await fetch(`${this.baseURL}/attendance/summary`, {
            headers: { 'X-Session-Id': this.sessionId }
        });
        return response.json();
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AttendanceAPI;
}