using BelfProctor.Models;

namespace BelfProctor.Services;

public interface IPolicyService
{
    Task LoadPoliciesAsync();
    Task UpdatePoliciesFromServerAsync();
    Task<bool> CheckPolicyViolationAsync(SystemEvent systemEvent);
    Task<List<SecurityPolicy>> GetActivePoliciesAsync();
    Task ApplyPolicyAsync(SecurityPolicy policy);
}