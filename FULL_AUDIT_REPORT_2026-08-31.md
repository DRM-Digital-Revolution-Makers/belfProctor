# BelfProctor — полный технический аудит

Дата проверки: 2026-08-31

## Итог

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
