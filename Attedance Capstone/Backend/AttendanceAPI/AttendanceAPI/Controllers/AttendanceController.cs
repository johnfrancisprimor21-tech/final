using Microsoft.AspNetCore.Mvc;
using AttendanceAPI.Models;
using AttendanceAPI.Services;
using System.Collections.Generic;

namespace AttendanceAPI.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AttendanceController : ControllerBase
    {
        // ============================================
        // SESSION → TEACHER RESOLUTION
        // ============================================

        private string? ResolveTeacher(out IActionResult? error)
        {
            if (!Request.Headers.TryGetValue("X-Session-Id", out var sessionId) ||
                string.IsNullOrWhiteSpace(sessionId))
            {
                error = Unauthorized(new { message = "Missing session header." });
                return null;
            }

            // BUG-03 FIX: Also read the session token header and pass it for validation
            Request.Headers.TryGetValue("X-Session-Token", out var sessionToken);

            var teacherId = DataService.GetTeacherIdFromSession(sessionId!, sessionToken.ToString());
            if (teacherId == null)
            {
                error = Unauthorized(new { message = "Session invalid or expired. Please log in again." });
                return null;
            }
            error = null;
            return teacherId;
        }

        // ============================================
        // SECTIONS
        // ============================================

        [HttpGet("sections")]
        public IActionResult GetSections()
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;
            var sections = DataService.GetSections(teacherId);
            return Ok(sections);
        }

        [HttpPost("sections")]
        public IActionResult CreateSection([FromBody] SectionRequest req)
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;

            if (req == null || string.IsNullOrWhiteSpace(req.Code) || string.IsNullOrWhiteSpace(req.Name))
                return BadRequest(new { message = "Section code and name are required." });

            if (DataService.SectionExists(req.Code, teacherId))
                return BadRequest(new { message = "Section code already exists." });

            DataService.CreateSection(req.Code, req.Name, req.Description ?? "", teacherId);
            return Ok(new { message = "Section created.", code = req.Code, name = req.Name });
        }

        [HttpPut("sections/{code}")]
        public IActionResult UpdateSection(string code, [FromBody] SectionRequest req)
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;

            if (req == null || string.IsNullOrWhiteSpace(req.Name))
                return BadRequest(new { message = "Section name is required." });

            bool updated = DataService.UpdateSection(code, req.Name, req.Description ?? "", teacherId);
            return updated
                ? Ok(new { message = "Section updated." })
                : NotFound(new { message = "Section not found." });
        }

        [HttpDelete("sections/{code}")]
        public IActionResult DeleteSection(string code)
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;

            bool deleted = DataService.DeleteSection(code, teacherId);
            return deleted
                ? Ok(new { message = "Section deleted." })
                : NotFound(new { message = "Section not found." });
        }

        // ============================================
        // STUDENTS (section-scoped)
        // ============================================

        [HttpPost("add-student")]
        public IActionResult AddStudent([FromBody] StudentRequest req)
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;

            if (req == null || string.IsNullOrWhiteSpace(req.Id) || string.IsNullOrWhiteSpace(req.FullName))
                return BadRequest(new { message = "Student ID and FullName are required." });

            if (DataService.StudentExists(req.Id, teacherId, req.SectionCode ?? ""))
                return BadRequest(new { message = "Student already exists in this section." });

            var student = new Student { Id = req.Id, FullName = req.FullName };
            DataService.AddStudent(student, teacherId, req.SectionCode ?? "");
            return Ok(new { message = "Student added.", studentId = req.Id });
        }

        [HttpGet("students")]
        public IActionResult GetStudents([FromQuery] string sectionCode = "")
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;
            return Ok(DataService.GetStudents(teacherId, sectionCode));
        }

        [HttpPut("update-student/{id}")]
        public IActionResult UpdateStudent(string id, [FromBody] StudentRequest req)
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;

            if (req == null || string.IsNullOrWhiteSpace(req.FullName))
                return BadRequest(new { message = "New name is required." });

            bool updated = DataService.UpdateStudentName(id, req.FullName, teacherId, req.SectionCode ?? "");
            return updated
                ? Ok(new { message = "Student updated." })
                : NotFound(new { message = "Student not found." });
        }

        [HttpDelete("remove-student/{id}")]
        public IActionResult RemoveStudent(string id, [FromQuery] string sectionCode = "")
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;

            if (!DataService.StudentExists(id, teacherId, sectionCode))
                return NotFound(new { message = "Student not found." });

            DataService.RemoveStudent(id, teacherId, sectionCode);
            return Ok(new { message = "Student removed." });
        }

        // ============================================
        // ATTENDANCE
        // ============================================

        [HttpPost("mark-attendance")]
        public IActionResult MarkAttendance([FromBody] AttendanceRequest req)
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;

            if (req == null || string.IsNullOrWhiteSpace(req.StudentId) || string.IsNullOrWhiteSpace(req.Status))
                return BadRequest(new { message = "StudentId and Status are required." });

            var attendance = new Attendance
            {
                StudentId = req.StudentId,
                Status    = req.Status,
                Date      = req.Date ?? DateTime.Now
            };
            
            var (added, msg) = DataService.AddAttendance(attendance, teacherId, req.SectionCode ?? "");
            if (!added)
                return Conflict(new { message = msg });
            return Ok(new { message = "Attendance recorded.", studentId = req.StudentId, status = req.Status, date = attendance.Date.ToString("yyyy-MM-dd") });
        }

        [HttpPost("mark-attendance-batch")]
        public IActionResult MarkAttendanceBatch([FromBody] List<AttendanceRequest> records)
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;

            if (records == null || records.Count == 0)
                return BadRequest(new { message = "Records required." });

            int success = 0, failed = 0;
            foreach (var rec in records)
            {
                if (string.IsNullOrWhiteSpace(rec.StudentId)) { failed++; continue; }
                var attendance = new Attendance
                {
                    StudentId = rec.StudentId,
                    Status    = rec.Status ?? "Present",
                    Date      = rec.Date ?? DateTime.Now
                };
                
                var (added, _) = DataService.AddAttendance(attendance, teacherId, rec.SectionCode ?? "");
                if (added) success++; else failed++;
            }
            return Ok(new { message = $"Batch processed: {success} success, {failed} failed", successful = success, failed });
        }

        [HttpGet("records")]
        public IActionResult GetRecords([FromQuery] string sectionCode = "")
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;
            var records = DataService.GetAllAttendanceRecords(teacherId, sectionCode);
            return Ok(records);
        }

        [HttpGet("summary")]
        public IActionResult GetSummary([FromQuery] string sectionCode = "")
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;
            var (present, absent) = DataService.GetAttendanceSummary(teacherId, sectionCode);
            return Ok(new { present, absent, total = present + absent, percentage = present + absent > 0 ? Math.Round((double)present / (present + absent) * 100, 2) : 0 });
        }

        [HttpGet("summary-by-date")]
        public IActionResult GetSummaryByDate([FromQuery] string date, [FromQuery] string sectionCode = "")
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;
            var (present, absent) = DataService.GetSummaryByDate(date, teacherId, sectionCode);
            return Ok(new { date, present, absent, total = present + absent });
        }

        [HttpGet("summary-by-student")]
        public IActionResult GetSummaryByStudent(string id)
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;
            var (present, absent) = DataService.GetSummaryByStudent(id, teacherId);
            var (percentage, p, a, total) = DataService.GetAttendancePercentage(id, teacherId);
            return Ok(new { studentId = id, present, absent, total, percentage });
        }

        [HttpGet("absent-by-date")]
        public IActionResult GetAbsentByDate([FromQuery] string date, [FromQuery] string sectionCode = "")
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;
            if (string.IsNullOrWhiteSpace(date)) return BadRequest(new { message = "Date required." });
            var students = DataService.GetAbsentByDate(date, teacherId, sectionCode);
            return Ok(new { date, count = students.Count, students });
        }

        [HttpGet("present-by-date")]
        public IActionResult GetPresentByDate([FromQuery] string date, [FromQuery] string sectionCode = "")
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;
            if (string.IsNullOrWhiteSpace(date)) return BadRequest(new { message = "Date required." });
            var students = DataService.GetPresentByDate(date, teacherId, sectionCode);
            return Ok(new { date, count = students.Count, students });
        }

        [HttpGet("student-history/{studentId}")]
        public IActionResult GetStudentHistory(string studentId)
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;
            var history = DataService.GetStudentAttendanceHistory(studentId, teacherId);
            return Ok(new { studentId, records = history, count = history.Count });
        }

        [HttpGet("attendance-range")]
        public IActionResult GetAttendanceByDateRange(string startDate, string endDate, [FromQuery] string sectionCode = "")
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;
            var records = DataService.GetAttendanceByDateRange(startDate, endDate, teacherId, sectionCode);
            return Ok(new { startDate, endDate, records, count = records.Count });
        }

        [HttpGet("statistics")]
        public IActionResult GetStatistics([FromQuery] string sectionCode = "")
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;
            return Ok(DataService.GetAttendanceStatistics(teacherId, sectionCode));
        }

        [HttpGet("attendance-dates")]
        public IActionResult GetAttendanceDates()
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;
            var dates = DataService.GetAttendanceDates(teacherId);
            return Ok(new { dates, count = dates.Count });
        }

        [HttpGet("export-csv")]
        public IActionResult ExportAttendanceAsCSV(string date = "", [FromQuery] string sectionCode = "")
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;
            var csv = DataService.ExportAttendanceAsCSV(teacherId, date, sectionCode);
            return Ok(new
            {
                filename = $"attendance_{(string.IsNullOrEmpty(date) ? "all" : date)}_{DateTime.Now:yyyy-MM-dd_HHmmss}.csv",
                data = csv
            });
        }

        [HttpDelete("delete-record/{studentId}/{date}")]
        public IActionResult DeleteAttendanceRecord(string studentId, string date)
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;
            bool deleted = DataService.DeleteAttendanceRecord(studentId, date, teacherId);
            return deleted
                ? Ok(new { message = "Record deleted." })
                : NotFound(new { message = "Record not found." });
        }

        
        private static readonly HashSet<string> ValidStatuses =
            new(StringComparer.OrdinalIgnoreCase) { "Present", "Absent", "Late" };

        [HttpPut("update-record/{studentId}/{date}/{newStatus}")]
        public IActionResult UpdateAttendanceStatus(string studentId, string date, string newStatus)
        {
            var teacherId = ResolveTeacher(out var err);
            if (teacherId == null) return err!;

            // BUG-06 FIX: Reject any status not in the allowed set
            if (!ValidStatuses.Contains(newStatus))
                return BadRequest(new { message = "Status must be Present, Absent, or Late." });

            bool updated = DataService.UpdateAttendanceStatus(studentId, date, newStatus, teacherId);
            return updated
                ? Ok(new { message = "Record updated." })
                : NotFound(new { message = "Record not found." });
        }
    }

    // ============================================
    // REQUEST DTOs
    // ============================================

    public class SectionRequest
    {
        public string Code        { get; set; } = "";
        public string Name        { get; set; } = "";
        public string? Description { get; set; }
    }

    public class StudentRequest
    {
        public string Id          { get; set; } = "";
        public string FullName    { get; set; } = "";
        public string? SectionCode { get; set; }
    }

    public class AttendanceRequest
    {
        public string StudentId    { get; set; } = "";
        public string Status       { get; set; } = "Present";
        public DateTime? Date      { get; set; }
        public string? SectionCode { get; set; }
    }
}
