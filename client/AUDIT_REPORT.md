# BelfProctor Client — Аудит кода и отчёт об ошибках

**Дата:** 2025-02-25  
**Область:** `client/` — C# Windows-клиент мониторинга

---

## Критичные проблемы

### 1. **KeyNotFoundException при запуске с корректным конфигом** (Program.cs)
**Файл:** `Program.cs`, строки 142–152  
**Суть:** При `needsConfig == true` читаются `overrides["ProctorSettings:ScreenshotIntervalMs"]` и др. Если все значения в `appsettings` корректны, `overrides` заполняется в `SanitizeInt`, но при первом проходе, когда `overrides.Count == 0`, блок `if (overrides.Count > 0) { builder.Configuration.AddInMemoryCollection(overrides); }` не выполняется — при последующем доступе к `overrides` возможен `KeyNotFoundException`, если ключ не был добавлен.

**Проверка:** `SanitizeInt` вызывается для всех опций и всегда добавляет значение в `overrides`. Значит, после цикла `overrides` содержит все нужные ключи. Проблема маловероятна при текущей логике, но стоит добавить защиту.

**Рекомендация:**
```csharp
// Перед needsConfig добавить проверку
if (overrides.Count == 0)
{
    SanitizeInt("ScreenshotIntervalMs", 300000);
    // ... остальные SanitizeInt гарантированно вызовутся
}
// Либо использовать overrides.TryGetValue(..., out var v) ? v : fallback
```

---

### 2. **Утечка таймеров при остановке** (ProctorWorker.cs)
**Файл:** `ProctorWorker.cs`  
**Суть:** В `StopAsync` не вызывается `Dispose` для `_heartbeatTimer` и `_activityReportTimer`. `policyUpdateTimer` создаётся локально в `ExecuteAsync` и в `finally` уничтожается, а `_activityReportTimer` — поле класса и нигде не освобождается.

**Рекомендация:**
```csharp
public override async Task StopAsync(CancellationToken cancellationToken)
{
    _logger.LogInformation("BelfProctor service stopping...");
    _heartbeatTimer?.Dispose();
    _activityReportTimer?.Dispose();
    _systemMonitorService.SystemEventOccurred -= OnSystemEventOccurred;
    // ...
}
```

---

### 3. **Двойное и преждевременное Dispose** (DataTransmissionService.cs)
**Файл:** `DataTransmissionService.cs`, строки 424–428  
**Суть:** В `SendReportAsync` внутри `using` блока вызываются `streamContent.Dispose()` и `fileStream.Dispose()`, хотя эти объекты уже обёрнуты в `using` и будут освобождены при выходе из блока. Это может привести к двойному Dispose и лишним исключениям.

**Рекомендация:** Удалить явные вызовы `Dispose()` и оставить только `using`.

---

### 4. **Пустая EncryptionKey и отправка незашифрованных данных** (DataTransmissionService.cs)
**Файл:** `DataTransmissionService.cs`, строки 442–446, 502–504  
**Суть:** При `string.IsNullOrEmpty(_settings.EncryptionKey)` данные отправляются без шифрования. Heartbeat, activity и события могут уйти по сети в открытом виде.

**Рекомендация:**  
- Либо запретить работу без `EncryptionKey` (валидация при старте),  
- Либо логировать предупреждение и не допускать отправку чувствительных данных без шифрования.

---

## Высокий приоритет

### 5. **BlockedProcesses не учитывается в политиках** (PolicyService.cs)
**Файл:** `PolicyService.cs`  
**Суть:** В `ProctorSettings` есть `BlockedProcesses` и `AllowedProcesses`. `PolicyService.CheckProcessRule` использует только `AllowedProcesses` для правила `Allow` и не учитывает `BlockedProcesses`. Пользовательские настройки из `appsettings` могут не применяться.

**Рекомендация:** Добавить проверку `BlockedProcesses` перед логикой правил политик:
```csharp
if (_settings.BlockedProcesses.Any(p => processName.Contains(p.ToLowerInvariant())))
    return true; // violation
```

---

### 6. **Потенциальный NullReference при TimingSafeEquals** (CommandHandler.cs)
**Файл:** `CommandHandler.cs`, строка 28  
**Суть:** `Convert.FromBase64String(currentHashB64)` при невалидной строке выбросит исключение. `TimingSafeEquals` получает `byte[]`; если `providedHash` или `currentHashB64` null/пусты, возможен NRE.

**Рекомендация:** Добавить проверки:
```csharp
if (string.IsNullOrEmpty(currentHashB64)) { ... return; }
try {
    var currentBytes = Convert.FromBase64String(currentHashB64);
    if (currentBytes == null || currentBytes.Length == 0) return;
    if (!TimingSafeEquals(currentBytes, providedHash)) { ... }
} catch (FormatException) { ... }
```

---

### 7. **DataTransmissionService не реализует IDisposable** (DataTransmissionService.cs)
**Файл:** `DataTransmissionService.cs`  
**Суть:** Класс объявляет `public void Dispose()` и освобождает `_httpClient`, `_retryTimer`, `_eventBatchTimer`, но не реализует интерфейс `IDisposable`. Сервис регистрируется как singleton, при остановке приложения `Dispose` может не вызываться.

**Рекомендация:** Реализовать `IDisposable` и зарегистрировать сервис с поддержкой dispose при остановке host’а.

---

### 8. **Aes не освобождается в GetEncryptedStreamContent** (DataTransmissionService.cs)
**Файл:** `DataTransmissionService.cs`, строки 524–540  
**Суть:** `Aes.Create()` создаёт объект, который не помещается в `using`. `CryptoStream` и `CombinedStream` при Dispose не освобождают `Aes`, возможна небольшая утечка ресурсов.

**Рекомендация:**  
```csharp
using var aes = Aes.Create();
aes.Key = ...;
aes.GenerateIV();
// ...
```

---

## Средний приоритет

### 9. **Путь WebSocket может не совпадать с сервером** (CommandChannelWorker.cs)
**Файл:** `CommandChannelWorker.cs`, `BuildWsUrl`  
**Суть:** Клиент подставляет путь `/ws`, сервер может ожидать другой путь (например, `/api/ws`). Нужно проверить конфигурацию WebSocket на сервере.

**Рекомендация:** Проверить фактический путь WebSocket на бэкенде и при необходимости добавить настройку пути (например, в `ProctorSettings`).

---

### 10. **Изменение настроек через setConfig не сохраняется** (CommandHandler.cs)
**Файл:** `CommandHandler.cs`, `ApplyIfPresent`  
**Суть:** `setConfig` меняет `_settings` в памяти, но не сохраняет в `appsettings.json`. После перезапуска изменения теряются.

**Рекомендация:** Добавить сохранение настроек в `appsettings.json` после применения команды `setConfig`.

---

### 11. **Политика policies/all может отсутствовать на сервере** (PolicyService.cs)
**Файл:** `PolicyService.cs`, строка 64  
**Суть:** Вызывается `DownloadPolicyAsync("all")`. Необходимо убедиться, что на сервере есть соответствующий endpoint (например, `GET /api/policies/all`).

---

### 12. **Отсутствие валидации путей в CommandHandler** (CommandHandler.cs)
**Файл:** `CommandHandler.cs`, команды `file` и `folder`  
**Суть:** `path` раскрывается через `ExpandEnvironmentVariables`, но не проверяется на path traversal (`..`, символьные ссылки). Возможен доступ к произвольным путям.

**Рекомендация:** Нормализовать путь и проверять, что он остаётся внутри разрешённых каталогов (например, `DirectoryRoots` или `%LOCALAPPDATA%\BelfProctor`).

---

## Низкий приоритет

### 13. **NuGetAudit = false** (BelfProctor.csproj)
**Файл:** `BelfProctor.csproj`  
**Суть:** `NuGetAudit` отключён, предупреждения об уязвимостях в пакетах не выдаются.

**Рекомендация:** Включить аудит (`<NuGetAudit>true</NuGetAudit>`) и периодически обновлять зависимости.

---

### 14. **Жёстко заданный пароль в CreateDefaultPolicies** (PolicyService.cs)
**Файл:** `PolicyService.cs`  
**Суть:** Дефолтные политики блокируют `cmd.exe` и `powershell.exe` для всех установок. В некоторых средах это может мешать администрированию.

**Рекомендация:** Сделать политики по умолчанию настраиваемыми (например, через конфиг или не включать блокировку до первого успешного обновления с сервера).

---

### 15. **Редкая гонка в ActivityMonitorService** (ActivityMonitorService.cs)
**Файл:** `ActivityMonitorService.cs`  
**Суть:** `UpdateState` вызывается из таймера, при изменении состояния — `ActivityChanged`. В `ProctorWorker.OnActivityChanged` вызывается `SendActivitySnapshot` через `Task.Run`. Теоретически возможна гонка при быстрых переключениях active/inactive.

**Рекомендация:** При необходимости добавить debounce (например, 500 ms) перед вызовом `SendActivitySnapshot`.

---

## Резюме

| Критичность | Количество | Примеры |
|-------------|------------|---------|
| Критичная   | 4          | Утечка таймеров, двойной Dispose, незашифрованная передача |
| Высокая     | 4          | Игнорирование BlockedProcesses, NRE, отсутствие IDisposable |
| Средняя     | 4          | WebSocket path, сохранение setConfig, path traversal |
| Низкая      | 3          | NuGetAudit, политики по умолчанию, гонка в ActivityMonitor |

**Рекомендуемый порядок исправления:**
1. ProctorWorker — Dispose таймеров  
2. DataTransmissionService — убрать лишний Dispose, реализовать IDisposable  
3. PolicyService — учёт BlockedProcesses  
4. CommandHandler — валидация пароля и path traversal  
5. Шифрование — политика при пустом EncryptionKey  

---

## Выполненные исправления (2025-02-25)

- [x] ProctorWorker: Dispose _heartbeatTimer, _activityReportTimer в StopAsync  
- [x] DataTransmissionService: удалён двойной Dispose, реализован IDisposable, Aes в using  
- [x] Program.cs: GetOverride для безопасного чтения overrides  
- [x] PolicyService: учёт BlockedProcesses, null-safe AllowedProcesses  
- [x] CommandHandler: безопасная проверка пароля (try/catch FromBase64String), TimingSafeEquals(null), path traversal (ResolveAndValidatePath), сохранение setConfig в appsettings.json  
- [x] BelfProctor.csproj: NuGetAudit=true  
- [x] DataTransmissionService: отписка от NetworkChange в Dispose, убраны лишние Dispose в FlushPendingAsync

Оставлено без изменений (требует проверки сервера/среды):
- WebSocket path (сервер принимает /ws)
- policies/all endpoint
- Дефолтные политики (cmd/powershell)
- Debounce в ActivityMonitorService
