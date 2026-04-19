using AttendanceAPI.Models;
using System.IO;
using System.Linq;
using System.Collections.Generic;

namespace AttendanceAPI.Services
{
    /// <summary>
    /// Flat-file data layer.
    ///
    /// FILE FORMATS (all scoped by teacherId):
    ///   students.txt   →  studentId,fullName,teacherId,sectionCode
    ///   attendance.txt →  studentId,status,date,teacherId,sectionCode
    ///   sections.txt   →  code|name|description|teacherId|createdAt
    /// </summary>
    public static class DataService
    {
        private static readonly string DataDir =
            Path.Combine(Directory.GetCurrentDirectory(), "Data");

        private static readonly string StudentFile =
            Path.Combine(DataDir, "students.txt");

        private static readonly string AttendanceFile =
            Path.Combine(DataDir, "attendance.txt");

        private static readonly string SessionsFile =
            Path.Combine(DataDir, "sessions.txt");

        private static readonly string SectionsFile =
            Path.Combine(DataDir, "sections.txt");

        private static readonly object _studentLock    = new();
        private static readonly object _attendanceLock = new();
        private static readonly object _sessionLock    = new();
        private static readonly object _sectionLock    = new();

        static DataService()
        {
            if (!Directory.Exists(DataDir))
                Directory.CreateDirectory(DataDir);

            foreach (var f in new[] { StudentFile, AttendanceFile, SessionsFile, SectionsFile })
                if (!File.Exists(f)) File.WriteAllText(f, "");
        }

        // =====================================================
        // SESSION
        // =====================================================

        // Session file format: sessionId|username|token|createdAt|expiresAt|status|role
       
        public static string? GetTeacherIdFromSession(string sessionId, string sessionToken = "")
        {
            return ResolveSession(sessionId, sessionToken, requiredRole: "teacher");
        }

        
        public static string? GetStudentIdFromSession(string sessionId, string sessionToken = "")
        {
            return ResolveSession(sessionId, sessionToken, requiredRole: "student");
        }

        private static string? ResolveSession(string sessionId, string sessionToken, string requiredRole)
        {
            if (string.IsNullOrWhiteSpace(sessionId)) return null;
            if (!File.Exists(SessionsFile)) return null;
            lock (_sessionLock)
            {
                foreach (var line in File.ReadAllLines(SessionsFile))
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    var p = line.Split('|');
                    if (p.Length < 6) continue;
                    if (p[0] != sessionId) continue;
                    if (p[5] != "active") continue;
                    if (DateTime.TryParse(p[4], out DateTime exp) && DateTime.Now > exp) continue;

                   
                    if (!string.IsNullOrWhiteSpace(sessionToken) && p[2] != sessionToken)
                        continue;

                    
                    string sessionRole = p.Length >= 7 ? p[6].Trim().ToLower() : "none";
                    if (sessionRole != requiredRole) continue;

                    return p[1]; // username
                }
            }
            return null;
        }

        // =====================================================
        // SECTIONS
        // =====================================================

        public static List<dynamic> GetSections(string teacherId)
        {
            var result = new List<dynamic>();
            if (!File.Exists(SectionsFile)) return result;
            lock (_sectionLock)
            {
                foreach (var line in File.ReadAllLines(SectionsFile))
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    var p = line.Split('|');
                    if (p.Length < 4 || p[3].Trim() != teacherId) continue;
                    result.Add(new
                    {
                        code        = p[0].Trim(),
                        name        = p[1].Trim(),
                        description = p.Length >= 3 ? p[2].Trim() : "",
                        teacherId   = p[3].Trim(),
                        createdAt   = p.Length >= 5 ? p[4].Trim() : ""
                    });
                }
            }
            return result;
        }

        public static bool SectionExists(string code, string teacherId)
        {
            if (!File.Exists(SectionsFile)) return false;
            lock (_sectionLock)
            {
                return File.ReadAllLines(SectionsFile).Any(line =>
                {
                    if (string.IsNullOrWhiteSpace(line)) return false;
                    var p = line.Split('|');
                    return p.Length >= 4 && p[0].Trim() == code && p[3].Trim() == teacherId;
                });
            }
        }

        public static void CreateSection(string code, string name, string description, string teacherId)
        {
            var createdAt = DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss");
            lock (_sectionLock)
            {
                File.AppendAllText(SectionsFile,
                    $"{code}|{name}|{description}|{teacherId}|{createdAt}\n");
            }
        }

        public static bool UpdateSection(string code, string newName, string newDescription, string teacherId)
        {
            if (!File.Exists(SectionsFile)) return false;
            lock (_sectionLock)
            {
                var lines = File.ReadAllLines(SectionsFile).ToList();
                bool updated = false;
                for (int i = 0; i < lines.Count; i++)
                {
                    var p = lines[i].Split('|');
                    if (p.Length < 4) continue;
                    if (p[0].Trim() == code && p[3].Trim() == teacherId)
                    {
                        var createdAt = p.Length >= 5 ? p[4].Trim() : "";
                        lines[i] = $"{code}|{newName}|{newDescription}|{teacherId}|{createdAt}";
                        updated = true;
                        break;
                    }
                }
                if (updated) File.WriteAllLines(SectionsFile, lines);
                return updated;
            }
        }

        public static bool DeleteSection(string code, string teacherId)
        {
            if (!File.Exists(SectionsFile)) return false;
            lock (_sectionLock)
            {
                var lines = File.ReadAllLines(SectionsFile).ToList();
                int before = lines.Count;
                lines = lines.Where(line =>
                {
                    if (string.IsNullOrWhiteSpace(line)) return false;
                    var p = line.Split('|');
                    return !(p.Length >= 4 && p[0].Trim() == code && p[3].Trim() == teacherId);
                }).ToList();
                if (lines.Count < before) { File.WriteAllLines(SectionsFile, lines); return true; }
                return false;
            }
        }

        // =====================================================
        // STUDENTS (section-scoped)
        // =====================================================

        public static void AddStudent(Student student, string teacherId, string sectionCode = "")
        {
            lock (_studentLock)
            {
                File.AppendAllText(StudentFile,
                    $"{student.Id},{student.FullName},{teacherId},{sectionCode}\n");
            }
        }

        public static bool StudentExists(string id, string teacherId, string sectionCode = "")
        {
            if (!File.Exists(StudentFile)) return false;
            lock (_studentLock)
            {
                return File.ReadAllLines(StudentFile).Any(s =>
                {
                    var p = s.Split(',');
                    if (p.Length < 3 || p[0].Trim() != id || p[2].Trim() != teacherId) return false;
                    if (!string.IsNullOrEmpty(sectionCode) && p.Length >= 4)
                        return p[3].Trim() == sectionCode;
                    return true;
                });
            }
        }

        public static List<dynamic> GetStudents(string teacherId, string sectionCode = "")
        {
            if (!File.Exists(StudentFile)) return new List<dynamic>();
            lock (_studentLock)
            {
                return File.ReadAllLines(StudentFile)
                    .Where(s =>
                    {
                        if (string.IsNullOrWhiteSpace(s)) return false;
                        var p = s.Split(',');
                        if (p.Length < 3 || p[2].Trim() != teacherId) return false;
                        if (!string.IsNullOrEmpty(sectionCode) && p.Length >= 4)
                            return p[3].Trim() == sectionCode;
                        return true;
                    })
                    .Select(s =>
                    {
                        var p = s.Split(',');
                        return (dynamic)new
                        {
                            id          = p[0].Trim(),
                            name        = p[1].Trim(),
                            sectionCode = p.Length >= 4 ? p[3].Trim() : ""
                        };
                    })
                    .ToList();
            }
        }

        public static bool UpdateStudentName(string id, string newName, string teacherId, string sectionCode = "")
        {
            if (!File.Exists(StudentFile)) return false;
            lock (_studentLock)
            {
                var lines = File.ReadAllLines(StudentFile).ToList();
                bool updated = false;
                for (int i = 0; i < lines.Count; i++)
                {
                    var p = lines[i].Split(',');
                    if (p.Length < 3 || p[0].Trim() != id || p[2].Trim() != teacherId) continue;
                    if (!string.IsNullOrEmpty(sectionCode) && p.Length >= 4 && p[3].Trim() != sectionCode) continue;
                    var sec = p.Length >= 4 ? p[3].Trim() : sectionCode;
                    lines[i] = $"{id},{newName},{teacherId},{sec}";
                    updated = true;
                    break;
                }
                if (updated) File.WriteAllLines(StudentFile, lines);
                return updated;
            }
        }

        public static void RemoveStudent(string id, string teacherId, string sectionCode = "")
        {
            lock (_studentLock)
            {
                if (File.Exists(StudentFile))
                {
                    var lines = File.ReadAllLines(StudentFile).Where(s =>
                    {
                        if (string.IsNullOrWhiteSpace(s)) return false;
                        var p = s.Split(',');
                        if (p.Length < 3 || p[0].Trim() != id || p[2].Trim() != teacherId) return true;
                        if (!string.IsNullOrEmpty(sectionCode) && p.Length >= 4)
                            return p[3].Trim() != sectionCode;
                        return false;
                    }).ToArray();
                    File.WriteAllLines(StudentFile, lines);
                }
            }
            lock (_attendanceLock)
            {
                if (File.Exists(AttendanceFile))
                {
                    var records = File.ReadAllLines(AttendanceFile).Where(r =>
                    {
                        if (string.IsNullOrWhiteSpace(r)) return false;
                        var p = r.Split(',');
                        if (p.Length < 4 || p[0].Trim() != id || p[3].Trim() != teacherId) return true;
                        if (!string.IsNullOrEmpty(sectionCode) && p.Length >= 5)
                            return p[4].Trim() != sectionCode;
                        return false;
                    }).ToArray();
                    File.WriteAllLines(AttendanceFile, records);
                }
            }
        }

        // =====================================================
        // ATTENDANCE (section-scoped)
        // =====================================================

        public static (bool added, string message) AddAttendance(Attendance attendance, string teacherId, string sectionCode = "")
        {
            if (string.IsNullOrWhiteSpace(attendance.Date.ToString()))
                attendance.Date = DateTime.Now;

            string dateKey = attendance.Date.ToString("yyyy-MM-dd");

            lock (_attendanceLock)
            {
                // Prevent duplicate attendance records for the same student/date/teacher
                if (File.Exists(AttendanceFile))
                {
                    foreach (var r in File.ReadAllLines(AttendanceFile))
                    {
                        if (string.IsNullOrWhiteSpace(r)) continue;
                        var p = r.Split(',');
                        if (p.Length < 4) continue;
                        if (p[0].Trim() == attendance.StudentId &&
                            p[2].Trim() == dateKey &&
                            p[3].Trim() == teacherId)
                        {
                            // Duplicate found — reject silently
                            return (false, $"Attendance for student '{attendance.StudentId}' on {dateKey} already exists.");
                        }
                    }
                }

                File.AppendAllText(AttendanceFile,
                    $"{attendance.StudentId},{attendance.Status},{dateKey},{teacherId},{sectionCode}\n");
                return (true, "Attendance recorded.");
            }
        }

        public static (int present, int absent) GetAttendanceSummary(string teacherId, string sectionCode = "")
        {
            if (!File.Exists(AttendanceFile)) return (0, 0);
            int present = 0, absent = 0;
            lock (_attendanceLock)
            {
                foreach (var r in File.ReadAllLines(AttendanceFile))
                {
                    var p = r.Split(',');
                    if (p.Length < 4 || p[3].Trim() != teacherId) continue;
                    if (!string.IsNullOrEmpty(sectionCode) && p.Length >= 5 && p[4].Trim() != sectionCode) continue;
                    if (p[1].Trim().ToLower() == "present") present++;
                    else if (p[1].Trim().ToLower() == "absent") absent++;
                }
            }
            return (present, absent);
        }

        public static (int present, int absent) GetSummaryByDate(string date, string teacherId, string sectionCode = "")
        {
            if (!File.Exists(AttendanceFile)) return (0, 0);
            int present = 0, absent = 0;
            lock (_attendanceLock)
            {
                foreach (var r in File.ReadAllLines(AttendanceFile))
                {
                    var p = r.Split(',');
                    if (p.Length < 4 || p[3].Trim() != teacherId || p[2].Trim() != date) continue;
                    if (!string.IsNullOrEmpty(sectionCode) && p.Length >= 5 && p[4].Trim() != sectionCode) continue;
                    var s = p[1].Trim().ToLower();
                    if (s == "present" || s == "p") present++;
                    else if (s == "absent" || s == "a") absent++;
                }
            }
            return (present, absent);
        }

        public static (int present, int absent) GetSummaryByStudent(string id, string teacherId)
        {
            if (!File.Exists(AttendanceFile)) return (0, 0);
            int present = 0, absent = 0;
            lock (_attendanceLock)
            {
                foreach (var r in File.ReadAllLines(AttendanceFile))
                {
                    var p = r.Split(',');
                    if (p.Length < 4 || p[0].Trim() != id || p[3].Trim() != teacherId) continue;
                    if (p[1].Trim().ToLower() == "present") present++;
                    else if (p[1].Trim().ToLower() == "absent") absent++;
                }
            }
            return (present, absent);
        }

        public static List<dynamic> GetAbsentByDate(string date, string teacherId, string sectionCode = "")
        {
            if (!File.Exists(AttendanceFile)) return new List<dynamic>();
            var names = LoadStudentNames(teacherId, sectionCode);
            var result = new List<dynamic>();
            lock (_attendanceLock)
            {
                foreach (var r in File.ReadAllLines(AttendanceFile))
                {
                    var p = r.Split(',');
                    if (p.Length < 4 || p[3].Trim() != teacherId || p[2].Trim() != date) continue;
                    if (!string.IsNullOrEmpty(sectionCode) && p.Length >= 5 && p[4].Trim() != sectionCode) continue;
                    var s = p[1].Trim().ToLower();
                    if (s == "absent" || s == "a")
                    {
                        var sid = p[0].Trim();
                        result.Add(new { id = sid, name = names.ContainsKey(sid) ? names[sid] : "Unknown", date });
                    }
                }
            }
            return result;
        }

        public static List<dynamic> GetPresentByDate(string date, string teacherId, string sectionCode = "")
        {
            if (!File.Exists(AttendanceFile)) return new List<dynamic>();
            var names = LoadStudentNames(teacherId, sectionCode);
            var result = new List<dynamic>();
            lock (_attendanceLock)
            {
                foreach (var r in File.ReadAllLines(AttendanceFile))
                {
                    var p = r.Split(',');
                    if (p.Length < 4 || p[3].Trim() != teacherId || p[2].Trim() != date) continue;
                    if (!string.IsNullOrEmpty(sectionCode) && p.Length >= 5 && p[4].Trim() != sectionCode) continue;
                    var s = p[1].Trim().ToLower();
                    if (s == "present" || s == "p")
                    {
                        var sid = p[0].Trim();
                        result.Add(new { id = sid, name = names.ContainsKey(sid) ? names[sid] : "Unknown", date });
                    }
                }
            }
            return result;
        }

        public static List<dynamic> GetAllAttendanceRecords(string teacherId, string sectionCode = "")
        {
            if (!File.Exists(AttendanceFile)) return new List<dynamic>();
            var names = LoadStudentNames(teacherId, sectionCode);
            var records = new List<dynamic>();
            lock (_attendanceLock)
            {
                foreach (var r in File.ReadAllLines(AttendanceFile))
                {
                    var p = r.Split(',');
                    if (p.Length < 4 || p[3].Trim() != teacherId) continue;
                    if (!string.IsNullOrEmpty(sectionCode) && p.Length >= 5 && p[4].Trim() != sectionCode) continue;
                    var sid = p[0].Trim();
                    records.Add(new
                    {
                        studentId   = sid,
                        studentName = names.ContainsKey(sid) ? names[sid] : "Unknown",
                        status      = p[1].Trim(),
                        date        = p[2].Trim(),
                        sectionCode = p.Length >= 5 ? p[4].Trim() : ""
                    });
                }
            }
            return records;
        }

        public static List<dynamic> GetAttendanceByDateRange(string startDate, string endDate, string teacherId, string sectionCode = "")
        {
            if (!File.Exists(AttendanceFile)) return new List<dynamic>();
            var names = LoadStudentNames(teacherId, sectionCode);
            var records = new List<dynamic>();
            lock (_attendanceLock)
            {
                foreach (var r in File.ReadAllLines(AttendanceFile))
                {
                    var p = r.Split(',');
                    if (p.Length < 4 || p[3].Trim() != teacherId) continue;
                    if (!string.IsNullOrEmpty(sectionCode) && p.Length >= 5 && p[4].Trim() != sectionCode) continue;
                    var d = p[2].Trim();
                    if (d.CompareTo(startDate) >= 0 && d.CompareTo(endDate) <= 0)
                    {
                        var sid = p[0].Trim();
                        records.Add(new { studentId = sid, studentName = names.ContainsKey(sid) ? names[sid] : "Unknown", status = p[1].Trim(), date = d });
                    }
                }
            }
            return records;
        }

        public static List<dynamic> GetStudentAttendanceHistory(string studentId, string teacherId)
        {
            if (!File.Exists(AttendanceFile)) return new List<dynamic>();
            var records = new List<dynamic>();
            lock (_attendanceLock)
            {
                foreach (var r in File.ReadAllLines(AttendanceFile))
                {
                    var p = r.Split(',');
                    if (p.Length < 4 || p[0].Trim() != studentId || p[3].Trim() != teacherId) continue;
                    records.Add(new { studentId = p[0].Trim(), status = p[1].Trim(), date = p[2].Trim(), sectionCode = p.Length >= 5 ? p[4].Trim() : "" });
                }
            }
            return records.OrderByDescending(r => r.date).ToList();
        }

        public static List<string> GetAttendanceDates(string teacherId)
        {
            if (!File.Exists(AttendanceFile)) return new List<string>();
            var dates = new HashSet<string>();
            lock (_attendanceLock)
            {
                foreach (var r in File.ReadAllLines(AttendanceFile))
                {
                    var p = r.Split(',');
                    if (p.Length < 4 || p[3].Trim() != teacherId) continue;
                    dates.Add(p[2].Trim());
                }
            }
            return dates.OrderByDescending(d => d).ToList();
        }

        public static (double percentage, int present, int absent, int total)
            GetAttendancePercentage(string studentId, string teacherId)
        {
            if (!File.Exists(AttendanceFile)) return (0, 0, 0, 0);
            int present = 0, absent = 0;
            lock (_attendanceLock)
            {
                foreach (var r in File.ReadAllLines(AttendanceFile))
                {
                    var p = r.Split(',');
                    if (p.Length < 4 || p[0].Trim() != studentId || p[3].Trim() != teacherId) continue;
                    if (p[1].Trim().ToLower() == "present") present++;
                    else if (p[1].Trim().ToLower() == "absent") absent++;
                }
            }
            int total = present + absent;
            return (total > 0 ? Math.Round((double)present / total * 100, 2) : 0, present, absent, total);
        }

        public static bool DeleteAttendanceRecord(string studentId, string date, string teacherId)
        {
            if (!File.Exists(AttendanceFile)) return false;
            lock (_attendanceLock)
            {
                var records = File.ReadAllLines(AttendanceFile).ToList();
                int before = records.Count;
                records = records.Where(r =>
                {
                    var p = r.Split(',');
                    return !(p.Length >= 4 && p[0].Trim() == studentId && p[2].Trim() == date && p[3].Trim() == teacherId);
                }).ToList();
                if (records.Count < before) { File.WriteAllLines(AttendanceFile, records); return true; }
            }
            return false;
        }

        public static bool UpdateAttendanceStatus(string studentId, string date, string newStatus, string teacherId)
        {
            if (!File.Exists(AttendanceFile)) return false;
            lock (_attendanceLock)
            {
                var records = File.ReadAllLines(AttendanceFile).ToList();
                bool updated = false;
                for (int i = 0; i < records.Count; i++)
                {
                    var p = records[i].Split(',');
                    if (p.Length < 4) continue;
                    if (p[0].Trim() == studentId && p[2].Trim() == date && p[3].Trim() == teacherId)
                    {
                        var sec = p.Length >= 5 ? p[4].Trim() : "";
                        records[i] = $"{studentId},{newStatus},{date},{teacherId},{sec}";
                        updated = true; break;
                    }
                }
                if (updated) File.WriteAllLines(AttendanceFile, records);
                return updated;
            }
        }

        public static string ExportAttendanceAsCSV(string teacherId, string date = "", string sectionCode = "")
        {
            if (!File.Exists(AttendanceFile)) return "";
            var names = LoadStudentNames(teacherId, sectionCode);
            var lines = new List<string> { "StudentID,StudentName,Status,Date,Section" };
            lock (_attendanceLock)
            {
                foreach (var r in File.ReadAllLines(AttendanceFile))
                {
                    var p = r.Split(',');
                    if (p.Length < 4 || p[3].Trim() != teacherId) continue;
                    if (!string.IsNullOrEmpty(sectionCode) && p.Length >= 5 && p[4].Trim() != sectionCode) continue;
                    if (!string.IsNullOrEmpty(date) && p[2].Trim() != date) continue;
                    var sid = p[0].Trim();
                    var sec = p.Length >= 5 ? p[4].Trim() : "";
                    lines.Add($"{sid},{(names.ContainsKey(sid) ? names[sid] : "Unknown")},{p[1].Trim()},{p[2].Trim()},{sec}");
                }
            }
            return string.Join("\n", lines);
        }

        public static dynamic GetAttendanceStatistics(string teacherId, string sectionCode = "")
        {
            var all     = GetAllAttendanceRecords(teacherId, sectionCode);
            int total   = all.Count;
            int present = all.Count(r => ((string)r.status).ToLower() == "present");
            int absent  = all.Count(r => ((string)r.status).ToLower() == "absent");
            int late    = all.Count(r => ((string)r.status).ToLower() == "late");
            double pct  = total > 0 ? Math.Round((double)present / total * 100, 2) : 0;
            return new
            {
                totalStudents            = GetStudents(teacherId, sectionCode).Count,
                totalAttendanceRecords   = total,
                presentCount             = present,
                absentCount              = absent,
                lateCount                = late,
                attendancePercentage     = pct,
                totalDatesWithAttendance = GetAttendanceDates(teacherId).Count
            };
        }

        private static Dictionary<string, string> LoadStudentNames(string teacherId, string sectionCode = "")
        {
            var map = new Dictionary<string, string>();
            if (!File.Exists(StudentFile)) return map;
            lock (_studentLock)
            {
                foreach (var line in File.ReadAllLines(StudentFile))
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    var p = line.Split(',');
                    if (p.Length < 3 || p[2].Trim() != teacherId) continue;
                    if (!string.IsNullOrEmpty(sectionCode) && p.Length >= 4 && p[3].Trim() != sectionCode) continue;
                    map[p[0].Trim()] = p[1].Trim();
                }
            }
            return map;
        }
    }
}
