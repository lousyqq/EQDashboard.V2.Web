using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using EQDashboard.V2.Web.Data;

namespace EQDashboard.V2.Web.Controllers;

// 以下為簡易 Read-Only API Controller，保持與原版完全相同的路由



[Route("api/[controller]")]
[ApiController]
public class AppsController : ControllerBase
{
    private readonly AppDbContext _context;
    public AppsController(AppDbContext context) { _context = context; }

    [HttpGet]
    public async Task<IActionResult> Get() => Ok(await _context.Apps.ToListAsync());
}

[Route("api/[controller]")]
[ApiController]
public class RequestsController : ControllerBase
{
    private readonly AppDbContext _context;
    public RequestsController(AppDbContext context) { _context = context; }

    [HttpGet]
    public async Task<IActionResult> Get() => Ok(await _context.Requests.ToListAsync());
}
