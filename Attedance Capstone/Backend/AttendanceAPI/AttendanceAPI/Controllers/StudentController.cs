using Microsoft.AspNetCore.Mvc;
using AttendanceAPI.Models;
using AttendanceAPI.Services;
using System;
using System.Collections.Generic;
using System.Linq;

namespace AttendanceAPI.Controllers
{
    [ApiController]
    [Route("api/student")]
    public class StudentController : ControllerBase
    {
        private readonly IStudentService _studentService;

        public StudentController(IStudentService studentService)
        {
            _studentService = studentService;
        }

        // ============================================
        // SESSION VALIDATION
        // Resolves X-Session-Id header to a userId.
        // Every endpoint calls this first — no more
        // bare "StudentId" header spoofing.
        // ============================================
        private string? ResolveUser(out IActionResult? error)
        {
            if (!Request.Headers.TryGetValue("X-Session-Id", out var sessionId) ||
                string.IsNullOrWhiteSpace(sessionId))
            {
                error = Unauthorized(new { message = "Missing X-Session-Id header. Please log in." });
                return null;
            }

            // BUG-03 FIX: Also validate the session token
            Request.Headers.TryGetValue("X-Session-Token", out var sessionToken);

            // BUG-09 FIX: Use GetStudentIdFromSession — rejects sessions with role != "student"
            var userId = DataService.GetStudentIdFromSession(sessionId!, sessionToken.ToString());
            if (userId == null)
            {
                error = Unauthorized(new { message = "Session invalid, expired, or not a student session." });
                return null;
            }

            error = null;
            return userId;
        }

        // ============================================
        // GET PROFILE
        // ============================================

        [HttpGet("{studentId}")]
        public IActionResult GetProfile(string studentId)
        {
            try
            {
                var userId = ResolveUser(out var err);
                if (userId == null) return err!;

                // Users can only read their own profile
                if (!string.Equals(userId, studentId, StringComparison.OrdinalIgnoreCase))
                    return Forbid();

                if (string.IsNullOrEmpty(studentId))
                    return BadRequest(new { message = "Student ID is required" });

                var profile = _studentService.GetStudentProfile(studentId);

                if (profile == null)
                {
                    return Ok(new
                    {
                        id = studentId,
                        studentId = studentId,
                        fullName = "Student",
                        email = "",
                        program = "",
                        yearLevel = ""
                    });
                }

                return Ok(new
                {
                    id = profile.Id,
                    studentId = profile.StudentId,
                    fullName = profile.FullName,
                    email = profile.Email,
                    program = profile.Program ?? "",
                    yearLevel = profile.YearLevel ?? ""
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in GetProfile: {ex.Message}");
                return StatusCode(500, new { error = ex.Message });
            }
        }

        // ============================================
        // UPDATE PROFILE
        // ============================================

        [HttpPut("{studentId}")]
        public IActionResult UpdateProfile(string studentId, [FromBody] StudentDTO studentDTO)
        {
            try
            {
                var userId = ResolveUser(out var err);
                if (userId == null) return err!;

                if (!string.Equals(userId, studentId, StringComparison.OrdinalIgnoreCase))
                    return Forbid();

                if (string.IsNullOrEmpty(studentId))
                    return BadRequest(new { message = "Student ID is required" });

                if (studentDTO == null)
                    return BadRequest(new { message = "Student data is required" });

                if (string.IsNullOrWhiteSpace(studentDTO.FullName) || string.IsNullOrWhiteSpace(studentDTO.Email))
                    return BadRequest(new { message = "Full Name and Email are required" });

                var updated = _studentService.UpdateStudentProfile(studentId, studentDTO);
                if (updated == null)
                    updated = _studentService.CreateStudentProfile(studentId, studentDTO);

                if (updated == null)
                    return StatusCode(500, new { message = "Failed to save profile" });

                return Ok(new
                {
                    message = "Profile updated successfully",
                    id = updated.Id,
                    studentId = updated.StudentId,
                    fullName = updated.FullName,
                    email = updated.Email,
                    program = updated.Program ?? "",
                    yearLevel = updated.YearLevel ?? ""
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in UpdateProfile: {ex.Message}");
                return StatusCode(500, new { error = ex.Message });
            }
        }

        // ============================================
        // RECORD ATTENDANCE
        // ============================================

        [HttpPost("attendance")]
        public IActionResult RecordAttendance([FromBody] AttendanceDTO attendanceDTO)
        {
            try
            {
                var userId = ResolveUser(out var err);
                if (userId == null) return err!;

                if (attendanceDTO == null)
                    return BadRequest(new { message = "Attendance data is required" });

                var record = _studentService.RecordAttendance(userId, attendanceDTO);
                if (record == null)
                    return BadRequest(new { message = "Failed to record attendance" });

                return Ok(new { message = "Attendance recorded", data = record });
            }
            catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
        }

        // ============================================
        // GET ATTENDANCE RECORDS
        // ============================================

        [HttpGet("attendance/records")]
        public IActionResult GetAttendanceRecords()
        {
            try
            {
                var userId = ResolveUser(out var err);
                if (userId == null) return err!;

                var records = _studentService.GetStudentAttendanceRecords(userId);
                return Ok(records ?? new List<Attendance>());
            }
            catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
        }

        // ============================================
        // ATTENDANCE STATS
        // ============================================

        [HttpGet("stats")]
        public IActionResult GetAttendanceStats()
        {
            try
            {
                var userId = ResolveUser(out var err);
                if (userId == null) return err!;

                var stats = _studentService.GetAttendanceStatistics(userId);
                return Ok(new
                {
                    total = stats?.total ?? 0,
                    present = stats?.present ?? 0,
                    absent = stats?.absent ?? 0,
                    late = stats?.late ?? 0,
                    excused = stats?.excused ?? 0,
                    attendancePercentage = stats?.attendancePercentage ?? 0,
                    rate = stats?.rate ?? 0,
                    streak = stats?.streak ?? 0
                });
            }
            catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
        }

        // ============================================
        // DELETE ATTENDANCE RECORD
        // ============================================

        [HttpDelete("attendance/{recordId}")]
        public IActionResult DeleteAttendance(int recordId)
        {
            try
            {
                var userId = ResolveUser(out var err);
                if (userId == null) return err!;

                // BUG-01 FIX: Pass userId so only the record owner can delete
                var deleted = _studentService.DeleteAttendanceRecord(recordId, userId);
                if (!deleted) return NotFound(new { message = "Attendance record not found" });
                return Ok(new { message = "Attendance record deleted" });
            }
            catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
        }

        // ============================================
        // COURSES
        // ============================================

        [HttpGet("courses")]
        public IActionResult GetCourses()
        {
            try
            {
                var userId = ResolveUser(out var err);
                if (userId == null) return err!;

                var courses = _studentService.GetStudentCourses(userId);
                return Ok(courses ?? new List<Course>());
            }
            catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
        }

        [HttpPost("courses")]
        public IActionResult AddCourse([FromBody] CourseDTO courseDTO)
        {
            try
            {
                var userId = ResolveUser(out var err);
                if (userId == null) return err!;

                if (courseDTO == null)
                    return BadRequest(new { message = "Course data is required" });

                var course = _studentService.AddCourse(userId, courseDTO);
                if (course == null)
                    return BadRequest(new { message = "Failed to add course" });

                return Ok(new { message = "Course added", data = course });
            }
            catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
        }

        [HttpDelete("courses/{courseId}")]
        public IActionResult RemoveCourse(int courseId)
        {
            try
            {
                var userId = ResolveUser(out var err);
                if (userId == null) return err!;

                var removed = _studentService.RemoveCourse(courseId, userId);
                if (!removed) return NotFound(new { message = "Course not found" });
                return Ok(new { message = "Course removed" });
            }
            catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
        }

        // ============================================
        // REPORTS
        // ============================================

        [HttpGet("reports/weekly")]
        public IActionResult GetWeeklyReport()
        {
            try
            {
                var userId = ResolveUser(out var err);
                if (userId == null) return err!;

                var report = _studentService.GetWeeklyReport(userId);
                return Ok(report);
            }
            catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
        }

        [HttpGet("reports/monthly")]
        public IActionResult GetMonthlyReport()
        {
            try
            {
                var userId = ResolveUser(out var err);
                if (userId == null) return err!;

                var report = _studentService.GetMonthlyReport(userId);
                return Ok(report);
            }
            catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
        }
    }
}
