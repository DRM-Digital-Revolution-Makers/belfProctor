# BelfProctor Windows agent

BelfProctor состоит из двух процессов одного подписанного EXE:

- служба `BelfProctor` (`--service-host`) работает как лёгкий LocalSystem-supervisor;
- задача `BelfProctor-Desktop` (`--auto-start`) запускает worker в интерактивной
  сессии для screenshot, activity, WMI/USB и live view.

## Требования

- Windows 11 или Windows Server 2022;
- права администратора для установки;
- production HTTPS endpoint;
- уникальные `ClientId` и `EncryptionKey` длиной не менее 32 символов;
- production code-signing PFX с доверенной цепочкой для выпуска.

Агент публикуется self-contained под `win-x64`; установка .NET Runtime на рабочую
станцию не требуется.

## Сборка подписанного release

Из корня репозитория:

```powershell
$password = Read-Host 'PFX password' -AsSecureString
.\client\build-release.ps1 `
  -PfxPath C:\secure\belfproctor-publisher.pfx `
  -PfxPassword $password
```

Конвейер создаёт self-contained single-file EXE, подписывает EXE, installer и
uninstaller, проверяет `Valid` Authenticode и точный signer thumbprint, формирует
SHA-256 manifest и ZIP. Unsigned batch wrappers и альтернативный unsigned publish
path не включаются; mutable config в ZIP отсутствует и создаётся подписанным
installer из safe template. Self-signed сертификат допустим только в отдельном
ephemeral test harness и не закрывает production gate.

Production release выполняется только из чистого Git worktree; manifest фиксирует
точный `sourceCommit` и `sourceState=clean`. Dirty-tree override доступен только
изолированному ephemeral pipeline test и не принимается с publisher PFX.

## Установка

Распакуйте подписанный ZIP и в elevated PowerShell запустите подписанный
installer с реальными значениями:

```powershell
.\install-windows-service.ps1 `
  -ServerUrl 'https://proctor.example.com/api' `
  -ClientId 'device-unique-id' `
  -EncryptionKey '<unique-32+-character-secret>' `
  -TrustedUpdateSignerThumbprint '<40-hex-publisher-thumbprint>'
```

Installer до изменения системы проверяет elevation, HTTPS, credentials,
собственную подпись и подписи EXE/uninstaller. Он копирует только эти подписанные
payloads и создаёт config из покрытого своей подписью safe template. Файлы размещаются в защищённом
`C:\Program Files\BelfProctor`; ACL даёт пользователю только чтение/запуск.
Self-install из GUI и автозапуск через `HKCU\Run` намеренно не поддерживаются.

## Конфигурация

Release загружает только защищённый `appsettings.json` рядом с EXE. GUI изменяет
его атомарной заменой, сохраняя не показанные в форме security-поля и feature
flags. Пользовательский `%LOCALAPPDATA%\BelfProctor\appsettings.json` допускается
только в Debug build и не может переопределить production-конфигурацию.

Обязательные поля:

```json
{
  "ProctorSettings": {
    "ServerUrl": "https://proctor.example.com/api",
    "ClientId": "device-unique-id",
    "EncryptionKey": "unique-secret-with-at-least-32-characters",
    "TrustedUpdateSignerThumbprint": "40_HEX_CHARACTERS_WITHOUT_SPACES",
    "ScreenshotIntervalMs": 300000,
    "ScreenshotQuality": 75,
    "MonitorUSB": true,
    "MonitorProcesses": true,
    "MonitorNetwork": true
  }
}
```

Новые payloads используют BPG1/AES-256-GCM, а transport в Release — только
HTTPS/WSS. Обновление проверяет SHA-256, `Valid` Authenticode и embedded signer,
после чего работает только из защищённого `.update` внутри install root. При
неуспешном запуске новой версии updater возвращает прежние service/task paths.

## Проверка и эксплуатация

```powershell
Get-Service BelfProctor
Get-ScheduledTask BelfProctor-Desktop
sc.exe qfailure BelfProctor
```

Автоматические и полевые проверки описаны в
[`TEST_PLAN.md`](../TEST_PLAN.md). Текущий подтверждённый статус и внешние
release-gates находятся в
[`FULL_AUDIT_REPORT_2026-08-31.md`](../FULL_AUDIT_REPORT_2026-08-31.md).

## Удаление

В elevated PowerShell из распакованного подписанного release:

```powershell
.\uninstall-windows-service.ps1
```

Uninstaller проверяет собственную Authenticode-подпись и ограничивает удаление
каноническими дочерними каталогами BelfProctor.
