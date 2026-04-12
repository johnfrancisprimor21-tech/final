using AttendanceAPI.Models;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace AttendanceAPI.Services
{
    public class StudentService : IStudentService
    {
        // FIX: Use Data/ subfolder with absolute path so files are always found
        // regardless of the working directory when the app runs
        private static readonly string _dataDir = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "Data");
        private static string _studentFile => Path.Combine(_dataDir, "students_data.txt");
        private static string _attendanceFile => Path.Combine(_dataDir, "attendance_records.txt");
        private static string _courseFile => Path.Combine(_dataDir, "student_courses.txt");
        private static int _nextCourseId = 1;

        // BUG-02 FIX: Locks to prevent race conditions on concurrent file writes
        private static readonly object _attendanceLock = new object();
        private static readonly object _courseLock = new object();
        private static readonly object _studentLock = new object();

        public StudentService()
        {
            EnsureFilesExist();
        }

        private void EnsureFilesExist()
        {
            // FIX: Ensure the Data/ directory exists before creating files
            if (!Directory.Exists(_dataDir))
                Directory.CreateDirectory(_dataDir);

            if (!File.Exists(_studentFile))
                File.Create(_studentFile).Close();
            if (!File.Exists(_attendanceFile))
                File.Create(_attendanceFile).Close();
            if (!File.Exists(_courseFile))
                File.Create(_courseFile).Close();
        }

        public Student GetStudentProfile(string studentId)
        {
            try
            {
                if (!File.Exists(_studentFile))
                    return null;

                var lines = File.ReadAllLines(_studentFile);
                foreach (var line in lines)
                {
                    if (string.IsNullOrWhiteSpace(line))
                        continue;

                    var parts = line.Split('|');
                    if (parts.Length > 0 && parts[0].Trim() == studentId)
                    {
                        return ParseStudentRecord(parts);
                    }
                }

                return null;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error getting student profile: {ex.Message}");
                return null;
            }
        }

        public Student UpdateStudentProfile(string studentId, StudentDTO studentDTO)
        {
            try
            {
                if (!File.Exists(_studentFile))
                    return null;

                var lines = File.ReadAllLines(_studentFile).ToList();
                bool found = false;

                for (int i = 0; i < lines.Count; i++)
                {
                    if (string.IsNullOrWhiteSpace(lines[i]))
                        continue;

                    var parts = lines[i].Split('|');
                    if (parts.Length > 0 && parts[0].Trim() == studentId)
                    {
                        string phone = parts.Length > 6 ? parts[6] : "";
                        string enrolledDate = parts.Length > 7 ? parts[7] : DateTime.Now.ToString("yyyy-MM-dd");
                        string isActive = parts.Length > 8 ? parts[8] : "true";

                        lines[i] = $"{studentId}|{studentDTO.FullName}|{studentDTO.Email}|{studentDTO.StudentId}|{studentDTO.Program ?? ""}|{studentDTO.YearLevel ?? ""}|{phone}|{enrolledDate}|{isActive}|{DateTime.Now:yyyy-MM-dd HH:mm:ss}";
                        found = true;
                        break;
                    }
                }

                if (found)
                {
                    File.WriteAllLines(_studentFile, lines);
                    return GetStudentProfile(studentId);
                }

                return null;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error updating student profile: {ex.Message}");
                return null;
            }
        }


        public Student CreateStudentProfile(string studentId, StudentDTO studentDTO)
        {
            try
            {
                // FIX: Creates a new student entry in students_data.txt
                // Called when UpdateStudentProfile returns null (student not yet registered)
                string enrolledDate = DateTime.Now.ToString("yyyy-MM-dd");
                string entry = $"{studentId}|{studentDTO.FullName}|{studentDTO.Email}|{studentDTO.StudentId ?? studentId}|{studentDTO.Program ?? ""}|{studentDTO.YearLevel ?? ""}||{enrolledDate}|true|{DateTime.Now:yyyy-MM-dd HH:mm:ss}\n";
                File.AppendAllText(_studentFile, entry);
                return GetStudentProfile(studentId);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error creating student profile: {ex.Message}");
                return null;
            }
        }

        public Attendance RecordAttendance(string studentId, AttendanceDTO attendanceDTO)
        {
            try
            {
                DateTime attendanceDate = attendanceDTO.Date == default(DateTime)
                    ? DateTime.Now
                    : attendanceDTO.Date;

                var attendance = new Attendance
                {
                    Id = GetNextAttendanceId(),
                    StudentId = studentId,
                    CourseId = attendanceDTO.CourseId,
                    Status = attendanceDTO.Status ?? "Present",
                    Date = attendanceDate,
                    Time = attendanceDTO.Time ?? "",
                    Room = attendanceDTO.Room ?? "",
                    Building = attendanceDTO.Building ?? "",
                    Notes = attendanceDTO.Notes ?? "",
                    Timestamp = DateTime.Now
                };

                var course = GetCourseById(attendanceDTO.CourseId);
                if (course != null)
                    attendance.CourseName = course.CourseName;

                string record = $"{attendance.Id}|{attendance.StudentId}|{attendance.CourseId}|{attendance.CourseName}|{attendance.Status}|{attendance.Date:yyyy-MM-dd}|{attendance.Time}|{attendance.Room}|{attendance.Building}|{attendance.Notes}|{attendance.Timestamp:yyyy-MM-dd HH:mm:ss}";

                // BUG-02 FIX: Lock file write to prevent race conditions
                lock (_attendanceLock)
                {
                    File.AppendAllText(_attendanceFile, record + "\n");
                }

                return attendance;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error recording attendance: {ex.Message}");
                return null;
            }
        }

        public List<Attendance> GetStudentAttendanceRecords(string studentId)
        {
            try
            {
                if (!File.Exists(_attendanceFile))
                    return new List<Attendance>();

                var records = new List<Attendance>();
                var lines = File.ReadAllLines(_attendanceFile);

                foreach (var line in lines)
                {
                    if (string.IsNullOrWhiteSpace(line))
                        continue;

                    var parts = line.Split('|');
                    if (parts.Length > 1 && parts[1].Trim() == studentId)
                    {
                        var record = ParseAttendanceRecord(parts);
                        if (record != null)
                            records.Add(record);
                    }
                }

                return records.OrderByDescending(r => r.Date).ToList();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error getting attendance records: {ex.Message}");
                return new List<Attendance>();
            }
        }

        public dynamic GetAttendanceStatistics(string studentId)
        {
            try
            {
                var records = GetStudentAttendanceRecords(studentId);

                int present = records.Count(r => r.Status?.ToLower() == "present");
                int absent = records.Count(r => r.Status?.ToLower() == "absent");
                int late = records.Count(r => r.Status?.ToLower() == "late");
                int excused = records.Count(r => r.Status?.ToLower() == "excused");
                int total = records.Count;

                double percentage = total > 0 ? Math.Round((double)present / total * 100, 2) : 0;

                return new
                {
                    total = total,
                    present = present,
                    absent = absent,
                    late = late,
                    excused = excused,
                    attendancePercentage = percentage,
                    rate = (int)percentage,
                    streak = CalculateStreak(records)
                };
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error calculating stats: {ex.Message}");
                return new { total = 0, present = 0, absent = 0, attendancePercentage = 0, rate = 0, streak = 0 };
            }
        }

        public bool DeleteAttendanceRecord(int recordId, string ownerId)
        {
            try
            {
                if (!File.Exists(_attendanceFile))
                    return false;

                // BUG-02 FIX: Lock file access to prevent race conditions
                lock (_attendanceLock)
                {
                    var lines = File.ReadAllLines(_attendanceFile).ToList();
                    int initialCount = lines.Count;

                    lines = lines.Where(line =>
                    {
                        if (string.IsNullOrWhiteSpace(line))
                            return true;

                        var parts = line.Split('|');
                        if (!(parts.Length > 0 && int.TryParse(parts[0], out int id) && id == recordId))
                            return true;

                        // BUG-01 FIX: Verify the record belongs to the requesting user
                        // parts[1] is studentId in the attendance record format
                        if (parts.Length > 1 && !string.Equals(parts[1].Trim(), ownerId, StringComparison.OrdinalIgnoreCase))
                            return true; // Not this user's record — leave it in

                        return false; // Remove this record
                    }).ToList();

                    if (lines.Count < initialCount)
                    {
                        File.WriteAllLines(_attendanceFile, lines);
                        return true;
                    }
                }

                return false;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error deleting attendance: {ex.Message}");
                return false;
            }
        }

        public List<Course> GetStudentCourses(string studentId)
        {
            try
            {
                if (!File.Exists(_courseFile))
                    return new List<Course>();

                var courses = new List<Course>();
                var lines = File.ReadAllLines(_courseFile);

                foreach (var line in lines)
                {
                    if (string.IsNullOrWhiteSpace(line))
                        continue;

                    var parts = line.Split('|');
                    if (parts.Length > 1 && parts[1].Trim() == studentId)
                    {
                        var course = ParseCourseRecord(parts);
                        if (course != null)
                            courses.Add(course);
                    }
                }

                return courses;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error getting courses: {ex.Message}");
                return new List<Course>();
            }
        }

        public Course AddCourse(string studentId, CourseDTO courseDTO)
        {
            try
            {
                var course = new Course
                {
                    Id = GetNextCourseId(),
                    StudentId = studentId,
                    CourseCode = courseDTO.CourseCode ?? "",
                    CourseName = courseDTO.CourseName ?? "",
                    InstructorEmail = courseDTO.InstructorEmail ?? "",
                    Schedule = courseDTO.Schedule ?? ""
                };

                string record = $"{course.Id}|{course.StudentId}|{course.CourseCode}|{course.CourseName}|{course.InstructorEmail}|{course.Schedule}|{DateTime.Now:yyyy-MM-dd HH:mm:ss}";

                File.AppendAllText(_courseFile, record + "\n");

                return course;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error adding course: {ex.Message}");
                return null;
            }
        }

        public bool RemoveCourse(int courseId, string ownerId)
        {
            try
            {
                if (!File.Exists(_courseFile))
                    return false;

                // BUG-02 FIX: Lock file access to prevent race conditions
                lock (_courseLock)
                {
                    var lines = File.ReadAllLines(_courseFile).ToList();
                    int initialCount = lines.Count;

                    lines = lines.Where(line =>
                    {
                        if (string.IsNullOrWhiteSpace(line))
                            return true;

                        var parts = line.Split('|');
                        if (!(parts.Length > 0 && int.TryParse(parts[0], out int id) && id == courseId))
                            return true;

                        // BUG-01 FIX: Verify the course belongs to the requesting student
                        // parts[1] is studentId in the course record format
                        if (parts.Length > 1 && !string.Equals(parts[1].Trim(), ownerId, StringComparison.OrdinalIgnoreCase))
                            return true; // Not this user's course — leave it

                        return false; // Remove this course
                    }).ToList();

                    if (lines.Count < initialCount)
                    {
                        File.WriteAllLines(_courseFile, lines);
                        return true;
                    }
                }

                return false;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error removing course: {ex.Message}");
                return false;
            }
        }

        public dynamic GetWeeklyReport(string studentId)
        {
            try
            {
                var records = GetStudentAttendanceRecords(studentId);
                var today = DateTime.Now;
                var weekAgo = today.AddDays(-7);

                var weeklyRecords = records.Where(r => r.Date >= weekAgo && r.Date <= today).ToList();

                int weeklyPresent = weeklyRecords.Count(r => r.Status?.ToLower() == "present");
                int weeklyTotal = weeklyRecords.Count;

                return new
                {
                    weeklyAttendance = weeklyPresent,
                    weeklyTotal = weeklyTotal,
                    weeklyPercentage = weeklyTotal > 0 ? Math.Round((double)weeklyPresent / weeklyTotal * 100, 2) : 0
                };
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error getting weekly report: {ex.Message}");
                return new { weeklyAttendance = 0, weeklyTotal = 0, weeklyPercentage = 0 };
            }
        }

        public dynamic GetMonthlyReport(string studentId)
        {
            try
            {
                var records = GetStudentAttendanceRecords(studentId);
                var today = DateTime.Now;
                var monthAgo = today.AddMonths(-1);

                var monthlyRecords = records.Where(r => r.Date >= monthAgo && r.Date <= today).ToList();

                int monthlyPresent = monthlyRecords.Count(r => r.Status?.ToLower() == "present");
                int monthlyTotal = monthlyRecords.Count;

                return new
                {
                    monthlyAttendance = monthlyPresent,
                    monthlyTotal = monthlyTotal,
                    monthlyPercentage = monthlyTotal > 0 ? Math.Round((double)monthlyPresent / monthlyTotal * 100, 2) : 0
                };
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error getting monthly report: {ex.Message}");
                return new { monthlyAttendance = 0, monthlyTotal = 0, monthlyPercentage = 0 };
            }
        }

        private Student ParseStudentRecord(string[] parts)
        {
            try
            {
                DateTime enrolledDate = DateTime.Now;
                if (parts.Length > 7 && DateTime.TryParse(parts[7], out DateTime parsedDate))
                {
                    enrolledDate = parsedDate;
                }

                return new Student
                {
                    Id = parts[0],
                    FullName = parts.Length > 1 ? parts[1] : "",
                    Email = parts.Length > 2 ? parts[2] : "",
                    StudentId = parts.Length > 3 ? parts[3] : "",
                    Program = parts.Length > 4 ? parts[4] : "",
                    YearLevel = parts.Length > 5 ? parts[5] : "",
                    PhoneNumber = parts.Length > 6 ? parts[6] : "",
                    EnrolledDate = enrolledDate,
                    IsActive = parts.Length > 8 ? bool.Parse(parts[8]) : true
                };
            }
            catch
            {
                return null;
            }
        }

        private Attendance ParseAttendanceRecord(string[] parts)
        {
            try
            {
                DateTime attendanceDate = DateTime.Now;
                if (parts.Length > 5 && DateTime.TryParse(parts[5], out DateTime parsedDate))
                {
                    attendanceDate = parsedDate;
                }

                return new Attendance
                {
                    Id = int.Parse(parts[0]),
                    StudentId = parts[1],
                    CourseId = int.Parse(parts[2]),
                    CourseName = parts.Length > 3 ? parts[3] : "",
                    Status = parts.Length > 4 ? parts[4] : "Present",
                    Date = attendanceDate,
                    Time = parts.Length > 6 ? parts[6] : "",
                    Room = parts.Length > 7 ? parts[7] : "",
                    Building = parts.Length > 8 ? parts[8] : "",
                    Notes = parts.Length > 9 ? parts[9] : "",
                    Timestamp = parts.Length > 10 && DateTime.TryParse(parts[10], out DateTime timeStamp) ? timeStamp : DateTime.Now
                };
            }
            catch
            {
                return null;
            }
        }

        private Course ParseCourseRecord(string[] parts)
        {
            try
            {
                return new Course
                {
                    Id = int.Parse(parts[0]),
                    StudentId = parts[1],
                    CourseCode = parts.Length > 2 ? parts[2] : "",
                    CourseName = parts.Length > 3 ? parts[3] : "",
                    InstructorEmail = parts.Length > 4 ? parts[4] : "",
                    Schedule = parts.Length > 5 ? parts[5] : ""
                };
            }
            catch
            {
                return null;
            }
        }

        private int GetNextAttendanceId()
        {
            try
            {
                if (!File.Exists(_attendanceFile))
                    return 1;

                var lines = File.ReadAllLines(_attendanceFile);
                int maxId = 0;

                foreach (var line in lines)
                {
                    if (string.IsNullOrWhiteSpace(line))
                        continue;

                    var parts = line.Split('|');
                    if (parts.Length > 0 && int.TryParse(parts[0], out int id))
                        maxId = Math.Max(maxId, id);
                }

                return maxId + 1;
            }
            catch
            {
                return 1;
            }
        }

        private int GetNextCourseId()
        {
            try
            {
                if (!File.Exists(_courseFile))
                    return 1;

                var lines = File.ReadAllLines(_courseFile);
                int maxId = 0;

                foreach (var line in lines)
                {
                    if (string.IsNullOrWhiteSpace(line))
                        continue;

                    var parts = line.Split('|');
                    if (parts.Length > 0 && int.TryParse(parts[0], out int id))
                        maxId = Math.Max(maxId, id);
                }

                return maxId + 1;
            }
            catch
            {
                return _nextCourseId++;
            }
        }

        private Course GetCourseById(int courseId)
        {
            try
            {
                if (!File.Exists(_courseFile))
                    return null;

                var lines = File.ReadAllLines(_courseFile);
                foreach (var line in lines)
                {
                    if (string.IsNullOrWhiteSpace(line))
                        continue;

                    var parts = line.Split('|');
                    if (parts.Length > 0 && int.TryParse(parts[0], out int id) && id == courseId)
                    {
                        return ParseCourseRecord(parts);
                    }
                }

                return null;
            }
            catch
            {
                return null;
            }
        }

        private int CalculateStreak(List<Attendance> records)
        {
            if (records.Count == 0)
                return 0;

            int streak = 0;
            var sortedRecords = records.OrderByDescending(r => r.Date).ToList();

            foreach (var record in sortedRecords)
            {
                if (record.Status?.ToLower() == "present")
                {
                    streak++;
                }
                else
                {
                    break;
                }
            }

            return streak;
        }
    }
}