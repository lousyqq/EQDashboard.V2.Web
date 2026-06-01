namespace EQDashboard.V2.Web.Services.Interfaces;

public interface IMenuAuthService
{
    Task<bool> CanManageMenuAsync(string empId, string menuId, bool isAdmin);
}
