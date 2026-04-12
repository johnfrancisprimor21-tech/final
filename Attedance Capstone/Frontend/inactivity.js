// =====================================================
// INACTIVITY TIMER — Shared across dashboards
// Logs out the user after a period of inactivity.
// Usage:
//   InactivityTimer.start(logoutFn, timeoutMs)
//   InactivityTimer.stop()
// =====================================================

const InactivityTimer = (() => {
    const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes default
    const WARNING_MS = 60 * 1000;       // warn 1 minute before logout

    let _timer = null;
    let _warningTimer = null;
    let _logoutFn = null;
    let _timeoutMs = TIMEOUT_MS;
    let _warningShown = false;

    const EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];

    function _clearTimers() {
        if (_timer) { clearTimeout(_timer); _timer = null; }
        if (_warningTimer) { clearTimeout(_warningTimer); _warningTimer = null; }
    }

    function _dismissWarning() {
        const banner = document.getElementById('inactivity-warning-banner');
        if (banner) banner.remove();
        _warningShown = false;
    }

    function _showWarning() {
        if (_warningShown) return;
        _warningShown = true;

        // Remove any existing banner first
        _dismissWarning();
        _warningShown = true;

        const banner = document.createElement('div');
        banner.id = 'inactivity-warning-banner';
        banner.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0;
            background: #e53e3e;
            color: #fff;
            text-align: center;
            padding: 12px 16px;
            font-size: 15px;
            font-weight: 600;
            z-index: 99999;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 16px;
        `;
        banner.innerHTML = `
            <span>⚠️ You will be logged out in 1 minute due to inactivity.</span>
            <button onclick="InactivityTimer._onActivity()" style="
                background:#fff; color:#e53e3e; border:none; border-radius:4px;
                padding:6px 14px; font-weight:700; cursor:pointer; font-size:14px;
            ">Stay Logged In</button>
        `;
        document.body.prepend(banner);
    }

    function _scheduleTimers() {
        _clearTimers();
        _warningTimer = setTimeout(() => {
            _showWarning();
        }, _timeoutMs - WARNING_MS);

        _timer = setTimeout(() => {
            _dismissWarning();
            if (typeof _logoutFn === 'function') {
                _logoutFn();
            }
        }, _timeoutMs);
    }

    function _onActivity() {
        _dismissWarning();
        _scheduleTimers();
    }

    function start(logoutFn, timeoutMs) {
        _logoutFn = logoutFn;
        _timeoutMs = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : TIMEOUT_MS;

        // Attach activity listeners
        EVENTS.forEach(evt => document.addEventListener(evt, _onActivity, { passive: true }));

        // Kick off the first timer
        _scheduleTimers();
    }

    function stop() {
        _clearTimers();
        _dismissWarning();
        EVENTS.forEach(evt => document.removeEventListener(evt, _onActivity));
        _logoutFn = null;
    }

    return { start, stop, _onActivity };
})();
