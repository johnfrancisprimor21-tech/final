using AttendanceAPI.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);

// =====================================================
// CONFIGURATION
// =====================================================

// Railway injects a PORT env var automatically.
// Locally it falls back to 7173.
var port = Environment.GetEnvironmentVariable("PORT") ?? "7173";
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

// =====================================================
// SERVICES REGISTRATION
// =====================================================

builder.Services.AddScoped<IStudentService, StudentService>();

builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
        options.JsonSerializerOptions.NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString;
        options.JsonSerializerOptions.DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull;
    });

// =====================================================
// CORS — allow any origin so your frontend hosted on
// GitHub Pages / Netlify can reach this API.
// =====================================================
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});

builder.Services.AddLogging(config =>
{
    config.AddConsole();
    config.SetMinimumLevel(LogLevel.Information);
});

var app = builder.Build();

// =====================================================
// MIDDLEWARE
// =====================================================

app.UseCors();

// =====================================================
// SERVE FRONTEND STATIC FILES
// Resolved relative to the executable — works on any
// machine and on Railway / Render.
// =====================================================

// When built: bin/Debug/net10.0/ → up 4 levels → solution root → Frontend
string frontendPath = Path.GetFullPath(
    Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "Frontend"));

// When running with "dotnet run" from the project folder
if (!Directory.Exists(frontendPath))
    frontendPath = Path.GetFullPath(
        Path.Combine(Directory.GetCurrentDirectory(), "..", "Frontend"));

Console.WriteLine($"Frontend path: {frontendPath}");

if (Directory.Exists(frontendPath))
{
    Console.WriteLine("Frontend folder found!");

    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(frontendPath),
        RequestPath = ""
    });

    // Serve the right entry-point HTML
    async Task ServeIndex(HttpContext ctx)
    {
        foreach (var f in new[] { "index.html", "auth.html", "student-dashboard.html" })
        {
            var fp = Path.Combine(frontendPath, f);
            if (System.IO.File.Exists(fp))
            {
                ctx.Response.ContentType = "text/html";
                await ctx.Response.SendFileAsync(fp);
                return;
            }
        }
        ctx.Response.StatusCode = 404;
        await ctx.Response.WriteAsync("No index file found.");
    }

    app.MapGet("/", ServeIndex);
    app.MapFallback(async ctx =>
    {
        if (!ctx.Request.Path.StartsWithSegments("/api"))
            await ServeIndex(ctx);
    });
}
else
{
    Console.WriteLine($"Frontend folder NOT found at: {frontendPath}");
    Console.WriteLine("API-only mode — no static files served.");
}

app.UseAuthorization();
app.MapControllers();

app.MapGet("/health", () => new { status = "healthy", timestamp = DateTime.UtcNow })
    .WithName("Health Check");

// =====================================================
// GLOBAL ERROR HANDLER
// =====================================================

app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async context =>
    {
        context.Response.StatusCode = 500;
        context.Response.ContentType = "application/json";
        var feature = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerPathFeature>();
        var exception = feature?.Error;
        Console.WriteLine($"Exception: {exception?.Message}");
        await context.Response.WriteAsJsonAsync(new
        {
            message = "An internal server error occurred",
            error = exception?.Message,
            statusCode = 500
        });
    });
});

Console.WriteLine("================================");
Console.WriteLine("Attendance System API");
Console.WriteLine($"Running on http://0.0.0.0:{port}");
Console.WriteLine($"Started at: {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
Console.WriteLine("================================");

app.Run();
