using AttendanceAPI.Models;
using System.Collections.Generic;

namespace AttendanceAPI.Services
{
    public interface IStudentService
    {
        // Profile Management
        Student GetStudentProfile(string studentId);
        Student UpdateStudentProfile(string studentId, StudentDTO studentDTO);
        Student CreateStudentProfile(string studentId, StudentDTO studentDTO); // FIX: new method for upsert

        // Attendance Management
        Attendance RecordAttendance(string studentId, AttendanceDTO attendanceDTO);
        List<Attendance> GetStudentAttendanceRecords(string studentId);
        dynamic GetAttendanceStatistics(string studentId);
        // BUG-01 FIX: ownerId param enforces that only the record owner can delete
        bool DeleteAttendanceRecord(int recordId, string ownerId);

        // Course Management
        List<Course> GetStudentCourses(string studentId);
        Course AddCourse(string studentId, CourseDTO courseDTO);
        // BUG FIX: ownerId param enforces that only the course owner can remove
        bool RemoveCourse(int courseId, string ownerId);

        // Reports
        dynamic GetWeeklyReport(string studentId);
        dynamic GetMonthlyReport(string studentId);
    }
}
