using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

// Alias fixes CS0119: inside a Controller, bare "File" resolves to
// ControllerBase.File() instead of System.IO.File. This alias removes ambiguity.
using SysFile = System.IO.File;

namespace AttendanceAPI.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AuthenticationController : ControllerBase
    {
        // ── File paths ──────────────────────────────────────────────────────────
        private static readonly string DataDir = Path.Combine(Directory.GetCurrentDirectory(), "Data");
        private static readonly string UsersFile = Path.Combine(DataDir, "users.txt");
        private static readonly string SessionsFile = Path.Combine(DataDir, "sessions.txt");
        // NEW-01 FIX: short-lived reset tokens (15 min), consumed on use
        private static readonly string ResetTokensFile = Path.Combine(DataDir, "reset_tokens.txt");

        // ── Constants ───────────────────────────────────────────────────────────
        private const int SALT_SIZE = 32;
        private const int HASH_ITERATIONS = 100_000;
        private const int SESSION_HOURS = 24;

        static AuthenticationController()
        {
            if (!Directory.Exists(DataDir))
                Directory.CreateDirectory(DataDir);
        }

        // ============================================================
        // POST /api/authentication/register
        // Body: { fullName, username, password, securityQuestion, securityAnswer }
        // ============================================================
        [HttpPost("register")]
        public IActionResult Register([FromBody] RegisterRequest req)
        {
            if (req == null)
                return BadRequest(new { message = "Request body is required." });

            if (string.IsNullOrWhiteSpace(req.FullName) || req.FullName.Trim().Length < 2)
                return BadRequest(new { message = "Full name must be at least 2 characters." });

            if (string.IsNullOrWhiteSpace(req.Username) || req.Username.Trim().Length < 3)
                return BadRequest(new { message = "Username must be at least 3 characters." });

            if (!Regex.IsMatch(req.Username.Trim(), @"^[a-zA-Z0-9._-]+$"))
                return BadRequest(new { message = "Username may only contain letters, numbers, dots, dashes, or underscores." });

            var pwError = ValidatePassword(req.Password);
            if (pwError != null)
                return BadRequest(new { message = pwError });

            if (string.IsNullOrWhiteSpace(req.SecurityQuestion))
                return BadRequest(new { message = "Security question is required." });

            if (string.IsNullOrWhiteSpace(req.SecurityAnswer) || req.SecurityAnswer.Trim().Length < 2)
                return BadRequest(new { message = "Security answer must be at least 2 characters." });

            string username = req.Username.Trim().ToLower();

            if (UsernameExists(username))
                return BadRequest(new { message = "Username is already taken." });

            string passwordHash = HashPassword(req.Password);
            string answerHash = HashAnswer(req.SecurityAnswer.Trim().ToLower());

            // Format: username|passwordHash|fullName|securityQuestion|answerHash|createdAt
            string entry = $"{username}|{passwordHash}|{req.FullName.Trim()}|{req.SecurityQuestion}|{answerHash}|{DateTime.Now:yyyy-MM-dd HH:mm:ss}";
            SysFile.AppendAllText(UsersFile, entry + "\n");

            return Ok(new { message = "Account created successfully." });
        }

        // ============================================================
        // POST /api/authentication/login
        // Body: { username, password }
        // ============================================================
        [HttpPost("login")]
        public IActionResult Login([FromBody] LoginRequest req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
                return BadRequest(new { message = "Username and password are required." });

            string username = req.Username.Trim().ToLower();
            var user = GetUser(username);

            if (user == null || !VerifyPassword(req.Password, user["passwordHash"]))
                return Unauthorized(new { message = "Incorrect username or password." });

            // NEW-02 FIX: Invalidate any previous active sessions for this user before
            // issuing a new one. Prevents old stolen session IDs from remaining valid.
            InvalidateAllSessionsForUser(username);

            string sessionId = Guid.NewGuid().ToString();
            string sessionToken = GenerateSecureToken();
            string expiresAt = DateTime.Now.AddHours(SESSION_HOURS).ToString("yyyy-MM-dd HH:mm:ss");

            // Format: sessionId|username|token|createdAt|expiresAt|status|role
            // role starts as "none" — client must call /select-role after choosing Teacher or Student
            string entry = $"{sessionId}|{username}|{sessionToken}|{DateTime.Now:yyyy-MM-dd HH:mm:ss}|{expiresAt}|active|none";
            SysFile.AppendAllText(SessionsFile, entry + "\n");

            return Ok(new
            {
                message = "Login successful",
                sessionId = sessionId,
                sessionToken = sessionToken,
                userId = username,
                username = username,
                fullName = user["fullName"],
                loginTime = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")
            });
        }

        // ============================================================
        // POST /api/authentication/logout
        // Body: { sessionId }
        // ============================================================
        [HttpPost("logout")]
        public IActionResult Logout([FromBody] LogoutRequest req)
        {
            if (!string.IsNullOrWhiteSpace(req?.SessionId))
                InvalidateSession(req.SessionId);

            return Ok(new { message = "Logged out successfully." });
        }

        // ============================================================
        // POST /api/authentication/select-role
        // Body: { sessionId, sessionToken, role }   role = "teacher" | "student"
        // Called from role-selector.html after the user picks a role.
        // Writes the chosen role into sessions.txt so the backend can enforce it.
        // ============================================================
        [HttpPost("select-role")]
        public IActionResult SelectRole([FromBody] SelectRoleRequest req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.SessionId) ||
                string.IsNullOrWhiteSpace(req.SessionToken) || string.IsNullOrWhiteSpace(req.Role))
                return BadRequest(new { message = "sessionId, sessionToken, and role are required." });

            string role = req.Role.Trim().ToLower();
            if (role != "teacher" && role != "student")
                return BadRequest(new { message = "role must be 'teacher' or 'student'." });

            if (!SysFile.Exists(SessionsFile))
                return Unauthorized(new { message = "Session not found." });

            var lines = SysFile.ReadAllLines(SessionsFile).ToList();
            bool updated = false;
            for (int i = 0; i < lines.Count; i++)
            {
                if (string.IsNullOrWhiteSpace(lines[i])) continue;
                var p = lines[i].Split('|');
                if (p.Length < 6) continue;
                if (p[0] != req.SessionId) continue;
                if (p[2] != req.SessionToken) continue;   // token must match
                if (p[5] != "active") continue;
                if (DateTime.TryParse(p[4], out DateTime exp) && DateTime.Now > exp) continue;

                // Set or overwrite the role field (index 6)
                if (p.Length == 6)
                    lines[i] = lines[i] + "|" + role;
                else
                {
                    p[6] = role;
                    lines[i] = string.Join('|', p);
                }
                updated = true;
                break;
            }

            if (!updated)
                return Unauthorized(new { message = "Session invalid, expired, or token mismatch." });

            SysFile.WriteAllLines(SessionsFile, lines);
            return Ok(new { message = $"Role set to {role}.", role });
        }

        // ============================================================
        // GET /api/authentication/validate-session/{sessionId}
        // ============================================================
        [HttpGet("validate-session/{sessionId}")]
        public IActionResult ValidateSession(string sessionId)
        {
            var session = GetSession(sessionId);
            if (session == null)
                return Unauthorized(new { valid = false, message = "Session invalid or expired." });

            return Ok(new { valid = true, userId = session["username"] });
        }

        // ============================================================
        // GET /api/authentication/check-username/{username}
        // ============================================================
        [HttpGet("check-username/{username}")]
        public IActionResult CheckUsername(string username)
        {
            if (string.IsNullOrWhiteSpace(username))
                return BadRequest(new { message = "Username is required." });

            bool available = !UsernameExists(username.Trim().ToLower());
            return Ok(new { available = available });
        }

        // ============================================================
        // GET /api/authentication/security-question/{username}
        // ============================================================
        [HttpGet("security-question/{username}")]
        public IActionResult GetSecurityQuestion(string username)
        {
            var user = GetUser(username.Trim().ToLower());
            if (user == null)
                return NotFound(new { message = "Account not found." });

            return Ok(new { question = user["securityQuestion"] });
        }

        // ============================================================
        // POST /api/authentication/verify-security-answer
        // Body: { username, answer }
        // Returns a short-lived resetToken on success (NEW-01 FIX).
        // ============================================================
        [HttpPost("verify-security-answer")]
        public IActionResult VerifySecurityAnswer([FromBody] SecurityAnswerRequest req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Answer))
                return BadRequest(new { message = "Username and answer are required." });

            var user = GetUser(req.Username.Trim().ToLower());
            if (user == null)
                return NotFound(new { message = "Account not found." });

            // BUG-05 FIX: Use constant-time VerifyAnswer instead of hash equality check
            if (!VerifyAnswer(req.Answer.Trim().ToLower(), user["answerHash"]))
                return Unauthorized(new { message = "Incorrect answer." });

            // NEW-01 FIX: Issue a short-lived reset token (15 min) so the backend can
            // verify the client actually passed the security-answer step before resetting.
            string resetToken = GenerateSecureToken();
            string expiresAt  = DateTime.Now.AddMinutes(15).ToString("yyyy-MM-dd HH:mm:ss");
            string username    = req.Username.Trim().ToLower();

            // Append to a lightweight reset-tokens store: username|token|expiresAt
            string resetEntry = $"{username}|{resetToken}|{expiresAt}";
            SysFile.AppendAllText(ResetTokensFile, resetEntry + "\n");

            return Ok(new { message = "Answer verified.", resetToken });
        }

        // ============================================================
        // POST /api/authentication/reset-password
        // Body: { username, resetToken, newPassword }
        // NEW-01 FIX: resetToken is required — issued by /verify-security-answer.
        // ============================================================
        [HttpPost("reset-password")]
        public IActionResult ResetPassword([FromBody] ResetPasswordRequest req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.Username) ||
                string.IsNullOrWhiteSpace(req.ResetToken) || string.IsNullOrWhiteSpace(req.NewPassword))
                return BadRequest(new { message = "Username, resetToken, and new password are required." });

            var pwError = ValidatePassword(req.NewPassword);
            if (pwError != null)
                return BadRequest(new { message = pwError });

            string username = req.Username.Trim().ToLower();

            // NEW-01 FIX: Validate and consume the reset token
            if (!ConsumeResetToken(username, req.ResetToken))
                return Unauthorized(new { message = "Reset token is invalid or has expired. Please restart the forgot-password flow." });

            var user = GetUser(username);
            if (user == null)
                return NotFound(new { message = "Account not found." });

            string newHash = HashPassword(req.NewPassword);
            bool updated = UpdateUserField(username, "passwordHash", newHash);

            if (!updated)
                return StatusCode(500, new { message = "Failed to update password." });

            InvalidateAllSessionsForUser(username);

            return Ok(new { message = "Password reset successfully." });
        }

        // ============================================================
        // HELPER — PASSWORD VALIDATION
        // ============================================================
        private static string ValidatePassword(string pw)
        {
            if (string.IsNullOrWhiteSpace(pw)) return "Password is required.";
            if (pw.Length < 8) return "Password must be at least 8 characters.";
            if (!pw.Any(char.IsUpper)) return "Password must contain at least one uppercase letter.";
            if (!pw.Any(char.IsDigit)) return "Password must contain at least one number.";
            if (pw.All(c => char.IsLetterOrDigit(c))) return "Password must contain at least one symbol.";
            return null;
        }

        // ============================================================
        // HELPER — PASSWORD HASHING  (PBKDF2 + random salt)
        // ============================================================
        private static string HashPassword(string password)
        {
            byte[] salt = RandomNumberGenerator.GetBytes(SALT_SIZE);
            byte[] hash = Rfc2898DeriveBytes.Pbkdf2(
                Encoding.UTF8.GetBytes(password),
                salt,
                HASH_ITERATIONS,
                HashAlgorithmName.SHA256,
                32
            );
            return $"{Convert.ToBase64String(salt)}:{Convert.ToBase64String(hash)}";
        }

        private static bool VerifyPassword(string password, string stored)
        {
            try
            {
                var parts = stored.Split(':');
                if (parts.Length != 2) return false;

                byte[] salt = Convert.FromBase64String(parts[0]);
                byte[] expected = Convert.FromBase64String(parts[1]);
                byte[] actual = Rfc2898DeriveBytes.Pbkdf2(
                    Encoding.UTF8.GetBytes(password),
                    salt,
                    HASH_ITERATIONS,
                    HashAlgorithmName.SHA256,
                    32
                );
                return CryptographicOperations.FixedTimeEquals(actual, expected);
            }
            catch { return false; }
        }

        // BUG-05 FIX: Use salted PBKDF2 for security answers (same as passwords).
        // Bare SHA-256 with no salt was trivially crackable via precomputed tables.
        private static string HashAnswer(string value)
        {
            byte[] salt = RandomNumberGenerator.GetBytes(16);
            byte[] hash = Rfc2898DeriveBytes.Pbkdf2(
                Encoding.UTF8.GetBytes(value), salt,
                10_000, HashAlgorithmName.SHA256, 32);
            return $"{Convert.ToBase64String(salt)}:{Convert.ToBase64String(hash)}";
        }

        // BUG-05 FIX: Constant-time verify for the salted answer hash
        private static bool VerifyAnswer(string value, string stored)
        {
            try
            {
                var parts = stored.Split(':');
                if (parts.Length != 2) return false;
                byte[] salt = Convert.FromBase64String(parts[0]);
                byte[] expected = Convert.FromBase64String(parts[1]);
                byte[] actual = Rfc2898DeriveBytes.Pbkdf2(
                    Encoding.UTF8.GetBytes(value), salt,
                    10_000, HashAlgorithmName.SHA256, 32);
                return CryptographicOperations.FixedTimeEquals(actual, expected);
            }
            catch { return false; }
        }

        // ============================================================
        // HELPER — SECURE TOKEN
        // ============================================================
        private static string GenerateSecureToken()
        {
            return Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        }

        // ============================================================
        // HELPER — USER FILE   (using SysFile alias throughout)
        // Format: username|passwordHash|fullName|securityQuestion|answerHash|createdAt
        // ============================================================
        private static bool UsernameExists(string username)
        {
            if (!SysFile.Exists(UsersFile)) return false;
            return SysFile.ReadAllLines(UsersFile)
                          .Any(l => !string.IsNullOrWhiteSpace(l) && l.Split('|')[0] == username);
        }

        private static Dictionary<string, string> GetUser(string username)
        {
            if (!SysFile.Exists(UsersFile)) return null;
            foreach (var line in SysFile.ReadAllLines(UsersFile))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                var p = line.Split('|');
                if (p.Length >= 6 && p[0] == username)
                    return new Dictionary<string, string>
                    {
                        ["username"] = p[0],
                        ["passwordHash"] = p[1],
                        ["fullName"] = p[2],
                        ["securityQuestion"] = p[3],
                        ["answerHash"] = p[4],
                        ["createdAt"] = p[5]
                    };
            }
            return null;
        }

        private static bool UpdateUserField(string username, string field, string newValue)
        {
            if (!SysFile.Exists(UsersFile)) return false;

            var fieldIndex = new Dictionary<string, int>
            {
                ["username"] = 0,
                ["passwordHash"] = 1,
                ["fullName"] = 2,
                ["securityQuestion"] = 3,
                ["answerHash"] = 4,
                ["createdAt"] = 5
            };

            if (!fieldIndex.TryGetValue(field, out int idx)) return false;

            var lines = SysFile.ReadAllLines(UsersFile).ToList();
            for (int i = 0; i < lines.Count; i++)
            {
                if (string.IsNullOrWhiteSpace(lines[i])) continue;
                var p = lines[i].Split('|');
                if (p.Length > idx && p[0] == username)
                {
                    p[idx] = newValue;
                    lines[i] = string.Join('|', p);
                    SysFile.WriteAllLines(UsersFile, lines);
                    return true;
                }
            }
            return false;
        }

        // ============================================================
        // HELPER — SESSION FILE   (using SysFile alias throughout)
        // Format: sessionId|username|token|createdAt|expiresAt|status
        // ============================================================
        private static Dictionary<string, string> GetSession(string sessionId)
        {
            if (!SysFile.Exists(SessionsFile)) return null;
            foreach (var line in SysFile.ReadAllLines(SessionsFile))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                var p = line.Split('|');
                if (p.Length < 6 || p[0] != sessionId || p[5] != "active") continue;
                if (DateTime.TryParse(p[4], out DateTime exp) && DateTime.Now > exp) continue;

                return new Dictionary<string, string>
                {
                    ["sessionId"] = p[0],
                    ["username"] = p[1],
                    ["token"] = p[2],
                    ["createdAt"] = p[3],
                    ["expiresAt"] = p[4],
                    ["status"] = p[5]
                };
            }
            return null;
        }

        private static void InvalidateSession(string sessionId)
        {
            if (!SysFile.Exists(SessionsFile)) return;
            var lines = SysFile.ReadAllLines(SessionsFile).ToList();
            for (int i = 0; i < lines.Count; i++)
            {
                var p = lines[i].Split('|');
                if (p.Length >= 6 && p[0] == sessionId)
                {
                    p[5] = "inactive";
                    lines[i] = string.Join('|', p);
                    break;
                }
            }
            SysFile.WriteAllLines(SessionsFile, lines);
        }

        // ============================================================
        // HELPER — RESET TOKENS  (NEW-01 FIX)
        // Format: username|token|expiresAt
        // ConsumeResetToken validates and deletes the token in one step
        // so each token is single-use.
        // ============================================================
        private static readonly object _resetLock = new();

        private static bool ConsumeResetToken(string username, string token)
        {
            if (!SysFile.Exists(ResetTokensFile)) return false;
            lock (_resetLock)
            {
                var lines = SysFile.ReadAllLines(ResetTokensFile).ToList();
                bool found = false;
                var remaining = new List<string>();
                foreach (var line in lines)
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    var p = line.Split('|');
                    if (p.Length < 3) continue;
                    // Always drop expired tokens
                    if (DateTime.TryParse(p[2], out DateTime exp) && DateTime.Now > exp) continue;
                    // Match and consume
                    if (p[0] == username && p[1] == token)
                    {
                        found = true; // consume — do NOT add to remaining
                        continue;
                    }
                    remaining.Add(line);
                }
                SysFile.WriteAllLines(ResetTokensFile, remaining);
                return found;
            }
        }

        private static void InvalidateAllSessionsForUser(string username)
        {
            if (!SysFile.Exists(SessionsFile)) return;
            var lines = SysFile.ReadAllLines(SessionsFile).ToList();
            for (int i = 0; i < lines.Count; i++)
            {
                var p = lines[i].Split('|');
                if (p.Length >= 6 && p[1] == username && p[5] == "active")
                {
                    p[5] = "inactive";
                    lines[i] = string.Join('|', p);
                }
            }
            SysFile.WriteAllLines(SessionsFile, lines);
        }
    }

    // ── Request / Response Models ────────────────────────────────────────────────

    public class RegisterRequest
    {
        public string FullName { get; set; }
        public string Username { get; set; }
        public string Password { get; set; }
        public string SecurityQuestion { get; set; }
        public string SecurityAnswer { get; set; }
    }

    public class LoginRequest
    {
        public string Username { get; set; }
        public string Password { get; set; }
    }

    public class LogoutRequest
    {
        public string SessionId { get; set; }
    }

    public class SelectRoleRequest
    {
        public string SessionId    { get; set; } = "";
        public string SessionToken { get; set; } = "";
        public string Role         { get; set; } = "";
    }

    public class SecurityAnswerRequest
    {
        public string Username { get; set; }
        public string Answer { get; set; }
    }

    public class ResetPasswordRequest
    {
        public string Username   { get; set; }
        public string ResetToken { get; set; }  // NEW-01 FIX: required
        public string NewPassword { get; set; }
    }
}