using EQDashboard.V2.Web.DTOs;

namespace EQDashboard.V2.Web.Services.Interfaces;

/// <summary>
/// 帳號服務介面 - 負責帳號的 CRUD 與批次匯入
/// </summary>
public interface IAccountService
{
    Task<PagedResult<AccountDto>> GetAccountsAsync(int page, int pageSize, string? search);
    Task<(bool success, string message)> CreateAccountAsync(AccountDto dto);
    Task<(bool success, string message)> UpdateAccountAsync(string id, AccountDto dto);
    Task<(bool success, string message)> DeleteAccountAsync(string id);
    Task<(bool success, string message)> BatchImportAsync(List<AccountDto> accounts);
}
