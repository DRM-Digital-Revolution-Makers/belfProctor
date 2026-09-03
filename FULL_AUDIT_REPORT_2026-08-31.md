# BelfProctor — полный технический аудит

Дата исходной проверки: 2026-08-31. Последняя перепроверка: 2026-09-03.

**Текущий подтверждённый статус: 97/100.** Актуальная матрица и два оставшихся
внешних release-gate приведены в разделе «Повторный аудит — 2026-09-03» ниже.

## Исходный итог 2026-08-31 (исторический baseline)

Текущая оценка готовности к production: **70/100 — ограниченный пилот в доверенной LAN, не публичный production**.

Сборки backend/frontend проходят, backend unit/integration tests проходят, известные production npm-уязвимости устранены. WebSocket-каналы агента теперь используют короткоживущую HMAC-подпись. Однако безопасный выпуск всё ещё блокируют HTTP в production-конфигурации, общий слабый ключ, отсутствие полноценной криптографической аутентификации ingestion-сообщений/обновлений, низкое покрытие backend и практически отсутствующие frontend E2E/unit tests.

## Что фактически проверено

- Backend TypeScript build: успешно.
- Backend Jest: 16 suites, 87/87 tests успешно.
- Backend coverage: statements 22.59%, branches 16.39%, functions 13.85%, lines 23.34%.
- Prisma schema: валидна при явно заданном `DATABASE_URL`.
- Docker Compose: production images собраны, чистая PostgreSQL поднята изолированно, все 5 миграций применены, DB/backend healthchecks успешны.
- Runtime smoke напрямую и через nginx: 13 checks — login, JWT denial, client registration, valid/invalid encrypted heartbeat, PostgreSQL persistence, encrypted screenshot upload/index/download/content equality, unsigned WS denial, signed WS connect и admin command delivery — успешно.
- Frontend ESLint: успешно после исправлений.
- Frontend production build: успешно.
- Production npm audit backend: 0 известных уязвимостей.
- Production npm audit frontend: 0 известных уязвимостей.
- Статический аудит API, auth, uploads, storage, retention, WebSocket, update flow, frontend и Windows agent.

Не удалось выполнить в текущей среде:

- .NET 10 SDK установлен временно; основной агент и все три test assemblies успешно собираются. Выполнение tests на macOS невозможно из-за отсутствующего WindowsDesktop runtime и остаётся Windows release gate.
- Playwright E2E полного стека: доступный browser runtime отсутствует; API/nginx заменять этим утверждением нельзя, поэтому Playwright остаётся отдельным непроверенным gate.
- Визуальный browser QA: ни встроенный, ни внешний браузер не подключён.
- Реальные Windows-проверки: service install/uninstall, multi-monitor screenshots, USB/WMI, session events, autostart, update/rollback.

## Блокирующие дефекты

### Исправлено — WebSocket агента ранее не был аутентифицирован

`/ws?clientId=...` и `/ws/stream?clientId=...` ранее принимали только произвольный `clientId`. Теперь агент передаёт HMAC-SHA256 от `clientId + timestamp`, сервер проверяет подпись constant-time и принимает окно не более ±120 секунд. Защита применяется и к command channel, и к Live View source; неизвестные WebSocket paths отклоняются.

Остаточный риск: пока устройства используют общий ключ, любой его обладатель может подписаться под другим `clientId`; в пределах 120 секунд возможен replay перехваченного URL. Для окончательного исправления нужны уникальные credentials/сертификаты устройств, challenge-response или nonce store и ротация credentials.

### Critical — update chain не обеспечивает подлинность

Агент получает URL и SHA-256 через неаутентифицированный WS. SHA-256 подтверждает целостность только относительно значения из того же скомпрометированного канала и не подтверждает издателя. При HTTP MITM может заменить и бинарник, и ожидаемый hash, получив выполнение кода с правами службы.

Нужно: HTTPS/WSS, Authenticode-подпись бинарника и обязательная проверка доверенного publisher/certificate thumbprint либо detached Ed25519 signature с публичным ключом, зашитым в агент.

### Critical — production agent использует HTTP и общий слабый ключ

В `client/appsettings.Production.json` указан `http://...`, а ключ `ABCDEFGHIJKLMNOP` повторяется в deploy-конфигурациях. PBKDF2 использует статическую соль и 10 000 итераций; AES-CBC не содержит MAC/tag. Данные можно перехватывать, CBC не гарантирует подлинность, компрометация одного агента раскрывает общий ключ остальных.

Нужно: HTTPS/WSS с проверкой сертификата, уникальный credential на устройство, AES-256-GCM/ChaCha20-Poly1305, versioned envelope и миграционный период.

### High — default deployment endpoints не согласованы

Docker Compose публикует backend на 4000 и frontend на 3000, README описывает backend `:4000`, но frontend fallback и agent settings используют `:8080`. Без дополнительного reverse proxy/default env локальный запуск из README не работает целиком.

Нужно: единая схема URL, dev proxy Vite и smoke test, который поднимает documented configuration.

## Существенные риски

### High — недостаточное покрытие автоматическими тестами

- Backend line coverage всего 23.34%; почти не покрыты крупные routes, `index.ts`, `store.ts`, uploads, commands, update deployment и error paths.
- Frontend не имеет unit/component tests; есть только 3 login E2E сценария.
- Нет контрактных tests между C# JSON payloads и TypeScript parsers.
- Нет migration test на чистой и обновляемой PostgreSQL базе.
- Нет end-to-end tests heartbeat → activity → screenshot → report → timesheet → retention.

### High — Release маскируется под Microsoft OneDrive

Release assembly/product/company названы `Microsoft One Drive`. Это создаёт риски AV/EDR-блокировки, ложной атрибуции и доверия пользователей. Нет подтверждённого code-signing pipeline.

Нужно: собственное стабильное имя продукта, publisher и Authenticode certificate; CI-проверка подписи install/update artifacts.

### Medium — JWT хранится в localStorage

При XSS токен администратора доступен JavaScript. Сейчас обнаруженной прямой XSS-инъекции нет, но frontend очень крупный и использует много зависимостей.

Рекомендуется: строгий CSP, запрет inline script, минимизация HTML rendering, либо HttpOnly/Secure/SameSite cookie с CSRF-защитой.

### Medium — rate limit практически отключён

Default 10 000 запросов/минуту и ключ по передаваемому `X-Client-Id` позволяют легко обходить ограничение сменой ID. Login не имеет отдельного строгого limiter.

Нужно: отдельный login limiter по IP/account, ingress limiter по provisioned device identity и глобальный ceiling.

### Medium — поддерживаемость frontend/backend

`ClientDetail.jsx` содержит 3467 строк, `SettingsPage.jsx` 1549, `Timesheet.jsx` 1371; backend `index.ts` 770 и `store.ts` 774. Это повышает риск регрессий и мешает изолированному тестированию. Production JS bundle около 3.04 MB (gzip ~992 KB), без code splitting.

### Medium — локальная backend-конфигурация неполна

`server/backend/.env` не содержит `DATABASE_URL`; прямой `npm run dev` запускается в конфигурации, где DB operations падают. Docker Compose адрес задаёт корректно.

## Исправлено в ходе аудита

- Закрыт неаутентифицированный GET-доступ к events, event stats, activity и heartbeat.
- Добавлены 6 regression tests для административных monitoring endpoints.
- Добавлена HMAC-аутентификация agent command/stream WebSocket и 4 regression tests подписи, привязки к клиенту и срока действия.
- Исправлены все ESLint errors/warnings frontend.
- Исправлена lifecycle dependency для Blob object URL preview.
- Удалены неиспользуемые `flyonui` и frontend `xlsx`.
- Некомпилируемый FlyonUI `@apply` заменён валидным CSS.
- Обновлены уязвимые production dependencies (`sharp`, `morgan`, React Router chain и транзитивные пакеты).
- Backend-only tooling `xlsx` перенесён в devDependencies, поэтому в runtime image он не устанавливается.
- Устранено предупреждение deprecated `ts-jest isolatedModules` config.
- Добавлен централизованный перехват rejected Promise из Express 4 routes и безопасный JSON 500 response; добавлен regression test без утечки внутренних деталей ошибки.
- Исправлены устаревшие имена production-настроек интервалов Windows-агента (`*IntervalMs`), которые ранее молча игнорировались.
- `Microsoft.Data.Sqlite` обновлён с 8.0.10 до 8.0.30: NuGet audit клиента теперь не находит известных уязвимостей.
- Исправлены production C# warnings: nullable config paths/overrides, nullable PDF metadata и несовместимый с single-file `Assembly.Location`; основной agent build теперь 0 warnings/0 errors.
- Multer обновлён с deprecated/security-affected 1.x до 2.3.0; upload regression и runtime screenshot smoke проходят.
- Добавлен воспроизводимый `npm run smoke` для реального API/PostgreSQL/nginx/WebSocket контура.
- Добавлен Compose backend healthcheck и ожидание `service_healthy` перед frontend, устранив гонку старта во время миграций.
- Multer upload errors теперь корректно классифицируются: превышение размера возвращает JSON HTTP 413 вместо общего 500; добавлен regression test.

## Release gates

До production-релиза обязательны:

1. Выдать уникальные device credentials и усилить текущую WS HMAC-схему challenge-response/одноразовым nonce для полной защиты от replay.
2. Только HTTPS/WSS; убрать HTTP autodiscovery из production режима.
3. Подписанные обновления с локальной проверкой publisher/signature.
4. Уникальные device credentials вместо общего ключа; AEAD encryption.
5. Запуск всех трёх .NET test projects на Windows .NET 10.
6. Docker integration tests на чистой PostgreSQL и upgrade существующей DB.
7. Расширить backend coverage хотя бы до 70% по критическим routes/services.
8. Добавить frontend component tests и E2E для основных экранов/ролей/ошибок.
9. Проверить installer, service recovery, offline queue, update rollback и retention на реальной Windows VM.
10. Привести documented ports/URLs к одной рабочей конфигурации.

После выполнения пунктов 1–4 и успешных Windows/Docker E2E проект можно повторно оценивать как production candidate.

---

## Повторный аудит — 2026-09-03

Текущая подтверждённая готовность: **97/100 — production candidate, выпуск заблокирован только внешними release-gates**.

| Gate | Статус | Подтверждение |
|---|---|---|
| 1. Уникальные device credentials и anti-replay | PASS | Production не принимает общий/default ключ; WS command/stream и скачивание update используют timestamp, криптографический nonce, HMAC и одноразовое nonce-хранилище. Download-подпись domain-separated и привязана к точной версии. |
| 2. Только HTTPS/WSS | PASS | Production требует `https://` URL; Compose публикует только nginx 80/443, делает redirect на TLS и выставляет HSTS/CSP; backend и PostgreSQL не публикуются наружу. |
| 3. Подписанные обновления | PARTIAL | Реализованы version-bound HMAC download, SHA-256, Authenticode `Valid`, точное сравнение thumbprint и embedded trust anchor; `build-release.ps1` подписывает и перепроверяет артефакты. Нужен реальный publisher PFX для финального артефакта. |
| 4. AEAD и отдельный ключ устройства | PASS | Новые данные используют `BPG1`/AES-256-GCM, random salt/nonce, PBKDF2-SHA256 210k; отсутствие ключа и tamper fail closed. CBC оставлен только для чтения миграционной очереди. |
| 5. Windows .NET 10 tests | PASS | Windows: unit 34/34, integration 4/4, system 3/3 (41/41 суммарно), Release build 0 warnings/0 errors; NuGet direct/transitive vulnerability audit — 0. |
| 6. Clean/upgrade DB migrations | PASS | Изолированный Compose: все 5 миграций на чистой PostgreSQL; отдельно подтверждено обновление БД с первыми четырьмя миграциями до пятой. Повторный старт: pending migrations нет. |
| 7. Backend coverage ≥70% | PASS | 167/167 Jest (29 suites); overall 72.39% lines, каждый критичный route ≥70%, `updates` 74.50%, `wsHub` 84.47%, services 97.75%; пороги закреплены в `jest.config.js`. |
| 8. Frontend component/E2E | PASS | ESLint PASS, component 6/6, Playwright 5/5: login, отсутствие JWT в JS, основные VIEWER-экраны и обработка API 500. |
| 9. Windows operational validation | PARTIAL | Подтверждены offline queue, retention, реальный process-monitor lifecycle и exact-agent multi-monitor capture. SCM теперь держит supervisor, а screenshot/activity/live-view worker запускается interactive scheduled task; пустые кадры fail closed. Installer/recovery/реальный update rollback, USB hardware и logon/logoff/reboot требуют elevated Windows VM и publisher-signed release. |
| 10. Единые URL/порты | PASS | Production документирован и реализован как единый public `https://` endpoint через nginx; HTTP разрешён только для loopback development/test и внутри Compose. Старые PM2/Windows 8/server bundle scripts удалены. |

Повторные проверки 2026-09-03:

- backend TypeScript build — PASS; полный npm audit (включая devDependencies) — 0 vulnerabilities;
- backend Jest — 29 suites, 167/167; overall 72.39% lines, все critical routes ≥70%, `updates` 74.50%, `wsHub` 84.47%, critical services 97.75%;
- frontend production build и синхронизация `dist` → backend `public` — PASS; полный npm audit — 0 vulnerabilities;
- Windows/.NET 10 — все три test projects PASS (unit 34/34, integration 4/4, system 3/3; 41/41 суммарно), Release build 0 warnings/0 errors; `dotnet list package --vulnerable --include-transitive` не нашёл уязвимых пакетов;
- PowerShell installer/uninstaller/release scripts — синтаксически валидны, отдельный installer/update safety-contract — PASS; production installer fail closed проверяет HTTPS, уникальные credentials и точный Authenticode signer до изменения службы. `ServiceName` и `InstallPath` закреплены ровно за `BelfProctor`/`%ProgramFiles%\BelfProctor`, install/uninstall отклоняют reparse root и foreign same-name service. Installer переносит только подписанные EXE/uninstaller, повторно проверяет уже защищённые staged copies и создаёт конфигурацию из покрытого собственной подписью safe template. Upgrade сохраняет существующий SCM service object; при сбое восстанавливаются прежние файлы, Scheduled Task, точный `ImagePath`, startup type, failure actions и running state;
- production agent публикуется self-contained single-file, поэтому atomic updater заменяет полный исполняемый payload.
- update download требует известный client с уникальным device key и свежую одноразовую HMAC-подпись, domain-separated от WebSocket-протокола и привязанную к точной версии; unsigned, изменённая версия и replay nonce отклоняются. Клиент запрещает HTTP и любые redirects, чтобы authentication headers не могли перейти на другой origin. Новая версия считается рабочей только после 15-секундного стабильного состояния supervisor и запуска exact-path interactive worker. При любой ошибке новая служба/задача останавливаются, восстанавливаются прежние SCM `ImagePath` и task action, затем подтверждается реальный запуск старой версии. Синтаксис генерируемого PowerShell закреплён отдельным AST gate.
- privileged updater больше не пишет download/lock/PowerShell в пользовательский `%TEMP%`: уникальные артефакты размещаются в `.update` внутри защищённого install root, выход из корня и reparse-point staging отклоняются; version name обязан начинаться с ASCII letter/digit, ограничен 64 безопасными символами, поэтому `.`/`..` и separator traversal fail closed. `versions` и конкретный version directory также не могут быть reparse points; unit regressions покрывают эти случаи.
- privileged uninstall теперь передаётся только подписанному `uninstall-windows-service.ps1` из защищённого install root после проверки exact embedded signer; unsigned temp-script больше не создаётся. Uninstaller валидирует каноническую границу Program Files, очищает только точные service/task/process/legacy persistence targets и fail closed, если install root не удалён.
- удалены оставшиеся legacy self-install, `%LOCALAPPDATA%` binary copy, `HKCU\Run` и пользовательский PowerShell-watchdog. Аргумент `--install-service` теперь fail closed: единственный installation path — подписанный elevated installer. Release игнорирует user-writable AppData config, GUI сохраняет защищённый config атомарно без потери signer/features и использует новую HttpOnly cookie-сессию при регистрации устройства.
- file/folder commands больше не получают неявный доступ ко всем корням дисков: разрешены только явно настроенные каталоги, path traversal и reparse points отклоняются, recursive enumeration пропускает reparse entries, search pattern и объём выдачи ограничены. Изменения интервалов сохраняются атомарно в защищённый authoritative config.
- все command creation, command-result metadata/latest-file endpoints требуют ADMIN; VIEWER остаётся read-only. Query-string token fallback удалён из HTTP и WebSocket auth, command IDs проверяются до построения пути, client-supplied timestamp/filename не участвуют в имени upload, временные/command IDs генерируются через `crypto.randomUUID()`.
- глобальный API limiter выполняется до JSON/multipart parsing, JSON body ограничен 2 MiB, а screenshot/report/command-result/update лимиты централизованно валидируются при старте. Неаутентифицированные/tampered ingestion-запросы не создают client и не изменяют `lastSeen`; report/command-result публикуются только после полной AEAD-проверки. BPG1-файлы расшифровываются потоком через уникальный staging file и атомарно становятся видимыми только после успешного GCM tag/padding check; абсолютные server paths клиенту не выдаются.
- повторное подтверждение административного пароля при удалении client передаётся только в HTTPS JSON body; прежний `X-Admin-Password` удалён из backend и CORS. Отдельные regression tests закрепляют ADMIN-only command/delete semantics и fail-closed ingestion.
- Усиленный Windows screenshot smoke выявил, что прежний Session-0/`BitBlt` путь создавал формально валидный, но полностью пустой JPEG. Архитектура изменена на service-supervisor + interactive task; `CopyFromScreen` обрабатывает весь virtual desktop, а недоступный desktop или uniform/blank frame отклоняется вместо загрузки. Exact published agent с `PerMonitorV2` успешно создал и визуально подтвердил JPEG 5120×1600 для двух дисплеев 2560×1440 и 2560×1600 (включая отрицательные virtual coordinates); JSON evidence сохранён рядом с кадром в `.artifacts/interactive-desktop-gate`. Отдельный smoke подтвердил реальное событие запуска процесса через WMI/polling monitor.
- полный release pipeline повторно проверен после последнего hardening на временном code-signing сертификате: self-contained publish, embedded thumbprint, криптографические Authenticode-подписи с точным signer match для EXE/installer/uninstaller, manifest hashes и ZIP — PASS. Manifest содержит ровно три подписанных payload'а; unsigned batch wrappers, mutable config и альтернативные unsigned publish/install flows удалены из production ZIP, config создаёт подписанный installer из safe template. Production release теперь fail closed отклоняет dirty Git worktree; manifest фиксирует точные `sourceCommit`/`sourceState`, а dirty override криптографически ограничен ephemeral test certificate. Текущий подписанный EXE имеет SHA-256 `B631051EC06D2E10E6D98E55B861B4D615ED69FBD8565C1A500643F8262890F1`, manifest — `32D38D91E308649C15A1E8CF2B7A3551C7E7D22AECF2D412CB0AEAF59C5750D1`, ZIP — `66E5973B2D8C735BC957D708991236020FDB6FCCF8B64381C7AC5C197459F8E2`. Его повторный interactive two-monitor gate 2026-09-03 корректно остановился до capture, потому что текущая Windows-сессия видит один дисплей; gate не ослаблялся. Предыдущий подписанный EXE (SHA-256 `3B1209F81BB71C5D036975D63AC7881F0F61D55AA817B475F7F448F7EEAFC5A6`) прошёл exact two-monitor gate: JPEG 5120×1600 и JSON evidence в `.artifacts/interactive-desktop-gate-signed-final`. Временная self-signed цепочка ожидаемо имеет `UnknownError` и разрешена только строго ограниченным test switch; production-конвейер принимает исключительно `Valid`. Тестовый сертификат после проверки удалён из `CurrentUser\My` (production gate требует настоящий publisher PFX с доверенной цепочкой).
- Node.js закреплён как `>=22.22.2 <23` через `.nvmrc`, `engines`, strict npm config и runtime preflight. Контрольный backend-прогон на нижней поддерживаемой 22.22.2: 29/29 suites, 167/167 tests, 72.39% lines; frontend: ESLint, 6/6 component tests, production build и 5/5 Playwright; оба полных npm audit — 0 vulnerabilities. Свежие transitive advisories `qs` и `@humanfs/node` устранены lockfile/override; неподдерживаемая версия Node останавливается до установки/теста/сборки с явной диагностикой.
- Чистые Docker `test` targets backend/frontend собраны и выполнили Jest/Vitest/ESLint — PASS. Проверка выявила и устранила отсутствие Jest/TypeScript test-конфигурации в backend image build context.
- Backend image запускает build через закреплённый package script и миграции через локальный Prisma binary, не используя `npx` resolver в production. Frontend `.dockerignore` исключает локальные npm/Playwright artifacts: контрольный build context уменьшен с 120.58 MB до 715 KB. nginx подавляет дубли upstream HSTS/CSP и отдаёт один канонический security-header set; `nginx -t`, HTTPS 200 и HTTP→HTTPS 301 подтверждены.
- Свежий изолированный Compose runtime текущего кода — PostgreSQL/backend healthy, frontend nginx запущен и отвечает через HTTPS, 5/5 миграций применены, HTTPS health 200, HSTS/CSP и `HttpOnly; Secure; SameSite=Strict` cookie подтверждены. Обновлённый full-stack smoke использует BPG1/AES-GCM, cookie-auth, проверяет WS nonce и update download HMAC/version/replay; 18/18 checks — PASS. Self-signed TLS был разрешён только процессу локального smoke.

Для честной оценки **100/100** остаются два внешних подтверждения, которые нельзя заменить тестовым сертификатом или не-elevated запуском:

1. Предоставить production code-signing PFX и пароль, собрать и проверить финальный подписанный ZIP.
2. На elevated Windows VM выполнить installer/service recovery/update rollback/uninstall и полевой сценарий USB hardware + logon/logoff/reboot.
