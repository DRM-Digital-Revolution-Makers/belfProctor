# BelfProctor — release test plan

Актуально на 2026-09-03. Production-топология — только `server/docker-compose.yml`,
единый внешний endpoint `https://<host>` и `wss://<host>`. HTTP разрешён только
на loopback в автоматических development-тестах и внутри изолированной Compose-сети.

## Требования

- Windows 11/Windows Server 2022;
- Node.js 22.22.2+ в ветке 22 (`.nvmrc`, диапазон `>=22.22.2 <23`);
- .NET SDK 10;
- Docker Desktop/Compose;
- production TLS certificate, production Authenticode PFX и elevated Windows VM
  для финального release gate.

## Автоматические проверки

```powershell
# Install/select the exact repository runtime first (for example with nvm-windows).
nvm use 22.22.2
node --version # must print v22.22.2+ on major 22

Set-Location server\backend
npm ci
npm run build
npm run test:coverage
npm audit

Set-Location ..\frontend
npm ci
npm run lint
npm test
npm run build
npm run e2e
npm audit

Set-Location ..\..\client
.\tests\verify-generated-updater-script.ps1
.\tests\verify-installer-safety-contract.ps1
..\.dotnet\dotnet.exe test tests\BelfProctor.UnitTests\BelfProctor.UnitTests.csproj -c Release
..\.dotnet\dotnet.exe test tests\BelfProctor.IntegrationTests\BelfProctor.IntegrationTests.csproj -c Release
..\.dotnet\dotnet.exe test tests\BelfProctor.SystemTests\BelfProctor.SystemTests.csproj -c Release
..\.dotnet\dotnet.exe list BelfProctor.csproj package --vulnerable --include-transitive
```

Ожидаемый минимум: backend overall lines ≥70% и каждый critical route/service
≥70%; все Jest/Vitest/Playwright/xUnit tests проходят; оба полных npm audit
возвращают 0 известных уязвимостей. Текущий baseline: backend 167/167 (29 suites,
overall lines 72.39%), frontend component 6/6, Playwright 5/5, .NET 41/41.
NuGet direct и transitive
vulnerability audit должен вернуть `no vulnerable packages`.

## Docker clean/upgrade проверки

1. Скопировать `server/.env.example` в `server/.env`, заменить все `change_me`,
   задать canonical `PUBLIC_BASE_URL=https://...` и trusted TLS paths.
2. Выполнить `docker compose up -d --build --wait` из `server`.
3. Проверить `docker compose exec backend npx prisma migrate status`: все пять
   миграций применены, pending migrations нет.
4. Через внешний HTTPS endpoint проверить health 200, HTTP→HTTPS 301/308, HSTS,
   CSP, login cookie `HttpOnly; Secure; SameSite=Strict` и `npm run smoke`.
5. Для upgrade gate восстановить копию БД на предыдущих четырёх миграциях,
   выполнить новый `migrate deploy` и повторно проверить status/health.

## Signed agent release

```powershell
$password = Read-Host 'PFX password' -AsSecureString
.\client\build-release.ps1 -PfxPath C:\secure\publisher.pfx -PfxPassword $password
```

Проверить ZIP и `release-manifest.json`: SHA-256 каждого файла, `Valid`
Authenticode status, точное совпадение signer thumbprint, `sourceState=clean` и
соответствие `sourceCommit` выпущенному commit. Production build из dirty Git
worktree обязан завершаться отказом. Тестовый/self-signed сертификат не закрывает
production gate.

## Elevated Windows VM gate

На чистом snapshot VM:

1. Запустить подписанный `install-windows-service.ps1` из release с PowerShell
   `AllSigned`, передав уникальные `ClientId`/32+ byte `EncryptionKey`, HTTPS
   `ServerUrl` и точный thumbprint. Unsigned batch-wrapper в production ZIP не входит.
2. Проверить LocalSystem service-supervisor `BelfProctor` (`--service-host`),
   interactive scheduled task `BelfProctor-Desktop` (`--auto-start`), restricted
   ACL и recovery actions. Убедиться, что Release читает config только из
   защищённого install root, self-install/HKCU watchdog отсутствуют, а `.update`
   расположен внутри install root и недоступен medium-integrity пользователю.
   Проверить, что произвольные `ServiceName`/`InstallPath`, reparse install root и
   foreign same-name service отклоняются до системной мутации.
3. По отдельности убить supervisor и interactive worker: SCM и задача/supervisor
   должны восстановить оба процесса и reconnect.
4. Отключить сеть: heartbeat/events/screenshots должны попасть в Pending; после
   возврата сети очередь должна быть отправлена ровно один раз.
5. Выполнить успешное signed update. Затем подать подписанную версию, которая не
   удерживает Running 15 секунд: должен восстановиться предыдущий `ImagePath` и
   старая служба должна снова работать.
6. Проверить два монитора, USB connect/disconnect, WMI process events,
   logon/logoff/reboot session events и screenshot retention. Для обязательного
   interactive capture запустить `client\tests\run-interactive-desktop-gate.ps1`;
   PASS обязан создать JPEG и JSON с двумя дисплеями в `.artifacts\interactive-desktop-gate`.
   Для финального publisher-signed артефакта передать `-AgentExe <release-exe>`.
7. Выполнить signed uninstaller; убедиться, что служба удалена, а удаление файлов
   не выходит за безопасный каталог `%ProgramFiles%\BelfProctor`.

Результаты полевого gate фиксируются в `FULL_AUDIT_REPORT_2026-08-31.md` с датой,
версией ZIP, manifest hash, thumbprint, Windows build и статусом каждого шага.
