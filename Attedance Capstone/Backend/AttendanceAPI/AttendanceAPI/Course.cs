using System;

namespace AttendanceAPI.Models
{
    public class Course
    {
        public int Id { get; set; }
        public string StudentId { get; set; }
        public string CourseCode { get; set; }
        public string CourseName { get; set; }
        public string InstructorEmail { get; set; }
        public string Schedule { get; set; }
        public string Room { get; set; }
        public string Building { get; set; }
        public DateTime CreatedAt { get; set; }
    }
}