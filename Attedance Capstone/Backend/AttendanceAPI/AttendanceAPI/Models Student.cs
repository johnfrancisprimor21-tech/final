using System;

namespace AttendanceAPI.Models
{
    public class Student
    {
        public string Id { get; set; }
        public string FullName { get; set; }
        public string Email { get; set; }
        public string StudentId { get; set; }
        public string Program { get; set; }
        public string YearLevel { get; set; }
        public string PhoneNumber { get; set; }
        public DateTime EnrolledDate { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime CreatedAt { get; set; } = DateTime.Now;
        public DateTime UpdatedAt { get; set; } = DateTime.Now;
    }

    public class StudentDTO
    {
        public string FullName { get; set; }
        public string Email { get; set; }
        public string StudentId { get; set; }
        public string Program { get; set; }
        public string YearLevel { get; set; }
    }

    public class StudentProfileResponse
    {
        public string FullName { get; set; }
        public string Email { get; set; }
        public string StudentId { get; set; }
        public string Program { get; set; }
        public string YearLevel { get; set; }
        public DateTime EnrolledDate { get; set; }
    }
}