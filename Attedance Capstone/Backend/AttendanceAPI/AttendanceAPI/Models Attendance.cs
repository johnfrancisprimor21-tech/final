using System;

namespace AttendanceAPI.Models
{
    public class Attendance
    {
        public int Id { get; set; }
        public string StudentId { get; set; }
        public int CourseId { get; set; }
        public string CourseName { get; set; }
        public string Status { get; set; } // Present, Absent, Late, Excused
        public DateTime Date { get; set; }
        public string Time { get; set; }
        public string Room { get; set; }
        public string Building { get; set; }
        public string Notes { get; set; }
        public DateTime Timestamp { get; set; } = DateTime.Now;
    }

    public class AttendanceDTO
    {
        public int CourseId { get; set; }
        public string Status { get; set; }
        public DateTime Date { get; set; }
        public string Time { get; set; }
        public string Room { get; set; }
        public string Building { get; set; }
        public string Notes { get; set; }
    }

    public class AttendanceStatsResponse
    {
        public int Total { get; set; }
        public int Present { get; set; }
        public int Absent { get; set; }
        public int Late { get; set; }
        public int Excused { get; set; }
        public double AttendancePercentage { get; set; }
        public int Streak { get; set; }
        public int Rate { get; set; }
    }
}