using System.Text;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using BelfProctor.Models;

namespace BelfProctor.Services;

public class PolicyService : IPolicyService
{
    private readonly ILogger<PolicyService> _logger;
    private readonly ProctorSettings _settings;
    private readonly IDataTransmissionService _dataTransmissionService;
    private readonly List<SecurityPolicy> _activePolicies = new();
    private readonly object _policiesLock = new();
    private readonly string _policiesFilePath;

    public PolicyService(
        ILogger<PolicyService> logger,
        IOptions<ProctorSettings> settings,
        IDataTransmissionService dataTransmissionService)
    {
        _logger = logger;
        _settings = settings.Value;
        _dataTransmissionService = dataTransmissionService;
        _policiesFilePath = Path.Combine(_settings.LogPath, "policies.json");
    }

    public async Task LoadPoliciesAsync()
    {
        try
        {
            if (File.Exists(_policiesFilePath))
            {
                var json = await File.ReadAllTextAsync(_policiesFilePath);
                var policies = JsonConvert.DeserializeObject<List<SecurityPolicy>>(json) ?? new List<SecurityPolicy>();
                
                lock (_policiesLock)
                {
                    _activePolicies.Clear();
                    _activePolicies.AddRange(policies.Where(p => p.IsActive));
                }
                
                _logger.LogInformation("Loaded {Count} active policies", _activePolicies.Count);
            }
            else
            {
                // Создаем политики по умолчанию
                await CreateDefaultPoliciesAsync();
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load policies");
        }
    }

    public async Task UpdatePoliciesFromServerAsync()
    {
        try
        {
            // Получаем список политик с сервера
            var policyData = await _dataTransmissionService.DownloadPolicyAsync("all");
            
            if (policyData.Length > 0)
            {
                var json = Encoding.UTF8.GetString(policyData);
                var serverPolicies = JsonConvert.DeserializeObject<List<SecurityPolicy>>(json) ?? new List<SecurityPolicy>();
                
                lock (_policiesLock)
                {
                    _activePolicies.Clear();
                    _activePolicies.AddRange(serverPolicies.Where(p => p.IsActive));
                }
                
                // Сохраняем политики локально
                await SavePoliciesAsync();
                
                _logger.LogInformation("Updated {Count} policies from server", _activePolicies.Count);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to update policies from server");
        }
    }

    public async Task<bool> CheckPolicyViolationAsync(SystemEvent systemEvent)
    {
        try
        {
            List<SecurityPolicy> policies;
            lock (_policiesLock)
            {
                policies = _activePolicies.ToList();
            }

            foreach (var policy in policies)
            {
                foreach (var rule in policy.Rules.Where(r => r.IsEnabled))
                {
                    if (await IsRuleViolatedAsync(rule, systemEvent))
                    {
                        _logger.LogWarning("Policy violation detected: {PolicyName} - {RuleType}", 
                            policy.Name, rule.Type);
                        
                        // Создаем событие нарушения политики
                        var violationEvent = new SystemEvent
                        {
                            Timestamp = DateTime.Now,
                            EventType = SystemEventType.PolicyViolation,
                            Description = $"Policy violation: {policy.Name}",
                            AdditionalData = new Dictionary<string, object>
                            {
                                ["PolicyId"] = policy.Id,
                                ["RuleId"] = rule.Id,
                                ["OriginalEvent"] = systemEvent
                            }
                        };

                        await _dataTransmissionService.SendSystemEventAsync(violationEvent);
                        return true;
                    }
                }
            }

            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking policy violations");
            return false;
        }
    }

    public async Task<List<SecurityPolicy>> GetActivePoliciesAsync()
    {
        lock (_policiesLock)
        {
            return _activePolicies.ToList();
        }
    }

    public async Task ApplyPolicyAsync(SecurityPolicy policy)
    {
        try
        {
            lock (_policiesLock)
            {
                var existingPolicy = _activePolicies.FirstOrDefault(p => p.Id == policy.Id);
                if (existingPolicy != null)
                {
                    _activePolicies.Remove(existingPolicy);
                }
                
                if (policy.IsActive)
                {
                    _activePolicies.Add(policy);
                }
            }

            await SavePoliciesAsync();
            _logger.LogInformation("Applied policy: {PolicyName}", policy.Name);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to apply policy: {PolicyName}", policy.Name);
        }
    }

    private async Task<bool> IsRuleViolatedAsync(PolicyRule rule, SystemEvent systemEvent)
    {
        try
        {
            switch (rule.Type)
            {
                case PolicyRuleType.ProcessControl:
                    return CheckProcessRule(rule, systemEvent);
                
                case PolicyRuleType.USBControl:
                    return CheckUSBRule(rule, systemEvent);
                
                case PolicyRuleType.NetworkControl:
                    return CheckNetworkRule(rule, systemEvent);
                
                case PolicyRuleType.FileAccess:
                    return CheckFileAccessRule(rule, systemEvent);
                
                default:
                    return false;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking rule violation: {RuleId}", rule.Id);
            return false;
        }
    }

    private bool CheckProcessRule(PolicyRule rule, SystemEvent systemEvent)
    {
        if (systemEvent.EventType != SystemEventType.ProcessStarted)
            return false;

        var processName = systemEvent.ProcessName?.ToLowerInvariant() ?? "";
        var target = rule.Target.ToLowerInvariant();

        switch (rule.Action)
        {
            case PolicyAction.Block:
                return processName.Contains(target);
            
            case PolicyAction.Allow:
                // Если процесс не в списке разрешенных
                return !_settings.AllowedProcesses.Any(p => 
                    processName.Contains(p.ToLowerInvariant()));
            
            default:
                return false;
        }
    }

    private bool CheckUSBRule(PolicyRule rule, SystemEvent systemEvent)
    {
        if (systemEvent.EventType != SystemEventType.USBConnected)
            return false;

        return rule.Action == PolicyAction.Block;
    }

    private bool CheckNetworkRule(PolicyRule rule, SystemEvent systemEvent)
    {
        if (systemEvent.EventType != SystemEventType.NetworkConnection)
            return false;

        var networkAddress = systemEvent.NetworkAddress ?? "";
        var target = rule.Target;

        switch (rule.Action)
        {
            case PolicyAction.Block:
                return networkAddress.Contains(target);
            
            default:
                return false;
        }
    }

    private bool CheckFileAccessRule(PolicyRule rule, SystemEvent systemEvent)
    {
        if (systemEvent.EventType != SystemEventType.FileAccess)
            return false;

        // Логика проверки доступа к файлам
        return false;
    }

    private async Task CreateDefaultPoliciesAsync()
    {
        var defaultPolicies = new List<SecurityPolicy>
        {
            new SecurityPolicy
            {
                Id = Guid.NewGuid().ToString(),
                Name = "Default Process Control",
                CreatedAt = DateTime.Now,
                UpdatedAt = DateTime.Now,
                IsActive = true,
                Rules = new List<PolicyRule>
                {
                    new PolicyRule
                    {
                        Id = Guid.NewGuid().ToString(),
                        Type = PolicyRuleType.ProcessControl,
                        Action = PolicyAction.Block,
                        Target = "cmd.exe",
                        IsEnabled = true
                    },
                    new PolicyRule
                    {
                        Id = Guid.NewGuid().ToString(),
                        Type = PolicyRuleType.ProcessControl,
                        Action = PolicyAction.Block,
                        Target = "powershell.exe",
                        IsEnabled = true
                    }
                }
            },
            new SecurityPolicy
            {
                Id = Guid.NewGuid().ToString(),
                Name = "USB Control",
                CreatedAt = DateTime.Now,
                UpdatedAt = DateTime.Now,
                IsActive = true,
                Rules = new List<PolicyRule>
                {
                    new PolicyRule
                    {
                        Id = Guid.NewGuid().ToString(),
                        Type = PolicyRuleType.USBControl,
                        Action = PolicyAction.Monitor,
                        Target = "*",
                        IsEnabled = true
                    }
                }
            }
        };

        lock (_policiesLock)
        {
            _activePolicies.Clear();
            _activePolicies.AddRange(defaultPolicies);
        }

        await SavePoliciesAsync();
        _logger.LogInformation("Created default policies");
    }

    private async Task SavePoliciesAsync()
    {
        try
        {
            List<SecurityPolicy> policies;
            lock (_policiesLock)
            {
                policies = _activePolicies.ToList();
            }

            var json = JsonConvert.SerializeObject(policies, Formatting.Indented);
            await File.WriteAllTextAsync(_policiesFilePath, json);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to save policies");
        }
    }
}