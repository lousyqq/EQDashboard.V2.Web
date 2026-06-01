using EQDashboard.V2.Web.Controllers;
using EQDashboard.V2.Web.Models;

namespace EQDashboard.V2.Web.Services.Interfaces;

public interface IAccountService
{
    Task<List<object>> GetAccountsAsync();
    Task<object?> GetAccountDetailsAsync(string empId);
    Task<(bool success, string errorMessage)> CreateAccountAsync(AccountFullDto dto);
    Task<(bool success, string errorMessage)> UpdateAccountAsync(string empId, AccountFullDto dto);
    Task<(bool success, string errorMessage)> DeleteAccountAsync(string empId);
}
