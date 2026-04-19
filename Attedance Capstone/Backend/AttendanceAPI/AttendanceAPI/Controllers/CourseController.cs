using Microsoft.AspNetCore.Mvc;
using System.Text.Json;
using System.Text.Json.Serialization;
using AttendanceAPI.Models;

namespace AttendanceAPI.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class CoursesController : ControllerBase
    {
        private readonly string _coursesFilePath = "courses.txt";
        private readonly ILogger<CoursesController> _logger;

        // FIX: Use camelCase JSON options pra mo match ASP.NET's global policy
        // Wala ni, ReadCoursesFromFile() deserializes with PascalCase (default)
        //  fails to map fields written by ASP.NET's camelCase serializer
        private static readonly JsonSerializerOptions _jsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true,  // tolerant reading
            WriteIndented = true
        };

        public CoursesController(ILogger<CoursesController> logger)
        {
            _logger = logger;
        }

        // GET: api/courses?studentId=STU001
        [HttpGet]
        public IActionResult GetCourses([FromQuery] string studentId)
        {
            try
            {
                if (string.IsNullOrEmpty(studentId))
                    return BadRequest(new { message = "studentId is required" });

                var courses = ReadCoursesFromFile();
                var studentCourses = courses
                    .Where(c => c.StudentId == studentId)
                    .ToList();

                return Ok(studentCourses);
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error getting courses: {ex.Message}");
                return BadRequest(new { message = "Error loading courses", error = ex.Message });
            }
        }

        // POST: api/courses
        [HttpPost]
        public IActionResult AddCourse([FromBody] Course course)
        {
            try
            {
                
                if (course == null)
                    return BadRequest(new { message = "Course data is required" });

                if (string.IsNullOrEmpty(course.CourseCode))
                    return BadRequest(new { message = "Course code is required" });

                if (string.IsNullOrEmpty(course.StudentId))
                    return BadRequest(new { message = "Student ID is required" });

                var courses = ReadCoursesFromFile();

                course.Id = courses.Count > 0 ? courses.Max(c => c.Id) + 1 : 1;
                course.CreatedAt = DateTime.Now;

                courses.Add(course);
                WriteCoursesToFile(courses);

                return Ok(new { message = "Course added successfully", data = course });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error adding course: {ex.Message}");
                return BadRequest(new { message = "Error adding course", error = ex.Message });
            }
        }

        // DELETE: api/courses/{id}
        [HttpDelete("{id}")]
        public IActionResult DeleteCourse(int id)
        {
            try
            {
                var courses = ReadCoursesFromFile();
                var courseToDelete = courses.FirstOrDefault(c => c.Id == id);

                if (courseToDelete == null)
                    return NotFound(new { message = "Course not found" });

                courses.Remove(courseToDelete);
                WriteCoursesToFile(courses);

                return Ok(new { message = "Course deleted successfully" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error deleting course: {ex.Message}");
                return BadRequest(new { message = "Error deleting course", error = ex.Message });
            }
        }

        private List<Course> ReadCoursesFromFile()
        {
            try
            {
                if (!System.IO.File.Exists(_coursesFilePath))
                    return new List<Course>();

                var json = System.IO.File.ReadAllText(_coursesFilePath);
                if (string.IsNullOrWhiteSpace(json))
                    return new List<Course>();

                // FIX: Use case-insensitive options so existing files still load correctly
                return JsonSerializer.Deserialize<List<Course>>(json, _jsonOptions) ?? new List<Course>();
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error reading courses file: {ex.Message}");
                return new List<Course>();
            }
        }

        private void WriteCoursesToFile(List<Course> courses)
        {
            try
            {
                
                var json = JsonSerializer.Serialize(courses, _jsonOptions);
                System.IO.File.WriteAllText(_coursesFilePath, json);
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error writing courses file: {ex.Message}");
                throw;
            }
        }
    }
}
