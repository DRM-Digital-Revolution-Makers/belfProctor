# BelfProctor — план тестирования на одном ноутбуке

Документ описывает, как **полностью** проверить систему (сервер + клиент + панель)
на одной машине, без второго ПК. Все команды проверены на Windows 11 + Node 20 +
.NET 10 + Docker.

> Прод TTYL: сервер на **Windows Server 2022**, Node 20 LTS, PostgreSQL. Клиенты —
> Windows-агенты. Локально мы воспроизводим это через Docker (Postgres) + локальный
> сервер + N процессов-клиентов.

---

## 0. Предварительные требования

| Инструмент | Зачем | Проверка |
|---|---|---|
| Node.js 20 LTS + npm | сервер, панель, Playwright | `node -v` |
| .NET 10 SDK | сборка/тесты клиента | `dotnet --version` |
| Docker | PostgreSQL (и при желании весь стек) | `docker --version` |
| PowerShell / bash | запуск команд | — |

---

## 1. Автоматические тесты (быстрый прогон, без поднятия стека)

### 1.1 Бэкенд (Jest) — 71 тест
```bash
cd server/backend
npm install
npx prisma generate
npm test          # или: npx jest
npx tsc --noEmit  # проверка типов
```
Покрывает: валидацию конфига/секретов (fail-fast), path traversal, отчёты/CSV,
retention (файловая часть), heartbeat-gap дедуп, pc-session, атомарность,
ташкентские границы месяца, аутентификацию, idempotent uninstall.

### 1.2 Клиент C# (xUnit) — 14 тестов в 3 проектах
```bash
cd client
dotnet test tests/BelfProctor.UnitTests/BelfProctor.UnitTests.csproj -c Debug
dotnet test tests/BelfProctor.IntegrationTests/BelfProctor.IntegrationTests.csproj -c Debug
dotnet test tests/BelfProctor.SystemTests/BelfProctor.SystemTests.csproj -c Debug
```
> Тесты собираются в Debug под именем `BelfProctor` (не маскировочным
> `Microsoft One Drive`), иначе Windows-политика блокирует загрузку DLL
> (ошибка `0x800711C7`). Prod-сборка — только `-c Release`.

### 1.3 Панель (Playwright E2E) — см. раздел 3, требует поднятого стека.

---

## 2. Поднятие полного стека локально

### 2.1 PostgreSQL в Docker
```bash
docker run -d --name belfproctor-pg \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=proctor \
  -p 5433:5432 postgres:15
# дождаться готовности:
docker exec belfproctor-pg pg_isready -U postgres
```

### 2.2 Миграции (ВАЖНО: проверяет фикс порядка миграций)
```bash
cd server/backend
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/proctor?schema=public" \
  npx prisma migrate deploy
```
Ожидаемо: применяются все 4 миграции без ошибки `P3018`. (До фикса свежий деплой
падал на `relation "BrowserActivity" does not exist`.)

### 2.3 Сервер (production-режим, проверяет хардену)
```bash
cd server/backend
npm run build
NODE_ENV=production PORT=8080 HOST=127.0.0.1 \
  DATABASE_URL="postgresql://postgres:postgres@localhost:5433/proctor?schema=public" \
  JWT_SECRET="a-strong-production-jwt-secret-1234567890" \
  ENCRYPTION_KEY="prod-encryption-key-abcdef123456" \
  DEFAULT_ADMIN_EMAIL="admin@ttyl.uz" DEFAULT_ADMIN_PASSWORD="Str0ngAdminPass!2026" \
  node dist/index.js
```
Сервер на `http://127.0.0.1:8080`, он же раздаёт собранную панель из
`server/frontend/dist`.

### 2.4 Панель (для разработки отдельно)
```bash
cd server/frontend
npm install
npm run build          # dist/ раздаётся бэкендом
# либо: npm run dev    # Vite на :5173 (задать VITE_API_URL=http://127.0.0.1:8080/api)
```

---

## 3. Проверка каждой функции (ручной чек-лист по API)

> Получить токен:
> ```bash
> TOKEN=$(curl -s -X POST http://127.0.0.1:8080/api/auth/login \
>   -H "Content-Type: application/json" \
>   -d '{"email":"admin@ttyl.uz","password":"Str0ngAdminPass!2026"}' | jq -r .token)
> ```

| # | Проверка | Команда / шаг | Ожидаемо |
|---|---|---|---|
| 1 | Health | `curl .../api/health` | `status:ok`, `database.ok:true`, диск, память |
| 2 | Health при упавшей БД | `docker stop belfproctor-pg` → `curl .../api/health` | HTTP **503**, `database.ok:false` |
| 3 | Логин (верный) | login выше | `{token}` |
| 4 | Логин (неверный) | пароль `wrong` | **401** |
| 5 | Защита без токена | `curl .../api/clients` | **401** |
| 6 | Защита с токеном | `-H "Authorization: Bearer $TOKEN"` | **200** |
| 7 | Path traversal | `GET /api/screenshots/..%2F..%2Fetc%2Fpasswd/file` | **400** |
| 8 | Отчёты (был стаб) | `GET /api/reports` | **200** `{data,total}` из БД |
| 9 | Fail-fast секретов | запустить сервер с `NODE_ENV=production JWT_SECRET=devsecret` | процесс **не стартует**, `[Config][FATAL]` |

### 3.1 Полный E2E панели (Playwright)
```bash
cd server/frontend
npx playwright install chromium     # один раз
E2E_BASE_URL=http://127.0.0.1:8080 \
E2E_ADMIN_EMAIL=admin@ttyl.uz E2E_ADMIN_PASSWORD='Str0ngAdminPass!2026' \
  npx playwright test
```
Сценарии: рендер логина, отказ при неверных кредах, успешный вход (JWT в
localStorage).

---

## 4. Эмуляция «многих клиентов» без множества ПК

Клиент — обычный .NET процесс; запускается с любым `ClientId`, смотрящим на
локальный сервер. Так проверяются авторегистрация, табель, гонки на сервере.

```powershell
# Собрать клиент один раз (Debug — обычное имя, не блокируется ОС):
cd client
dotnet build BelfProctor.csproj -c Debug

# Запустить N экземпляров с разными ClientId (пример для 3):
foreach ($i in 1..3) {
  $env:ProctorSettings__ClientId   = "TESTCLIENT0$i"
  $env:ProctorSettings__ServerUrl  = "http://127.0.0.1:8080/api"
  $env:ProctorSettings__EncryptionKey = "prod-encryption-key-abcdef123456"
  $env:ProctorSettings__MaxStartupJitterMs = "2000"
  Start-Process dotnet "run --no-build -c Debug --project BelfProctor.csproj"
}
```
Проверить в панели: появились 3 клиента, идут heartbeat/скриншоты/события.

> Для чисто нагрузочного теста (≈642 req/min при 60 клиентах) — скрипт на `k6`/
> `autocannon`, отправляющий зашифрованные пакеты как реальный клиент.

---

## 5. Целенаправленная инъекция сбоев (краевые случаи)

| Сбой | Как воспроизвести | Что проверить |
|---|---|---|
| БД упала во время загрузки скриншота | `docker stop belfproctor-pg` в момент POST `/screenshots` | нет файла-сироты (компенсация удаляет файл) |
| Path traversal | `curl '.../screenshots/..%2F..%2F..%2Fetc%2Fpasswd.jpg/file'` | 400, файл не отдан |
| Потеря сети у клиента | заблокировать порт 8080 фаерволом → разблокировать | данные копятся в Pending → flush при восстановлении |
| Перевод времени / смена TZ | сменить таймзону ноутбука | табель и uptime корректны (UTC/монотонные часы) |
| Перезагрузка ноутбука | reboot | корректные Boot/Shutdown PcSession, без нулевой длительности |
| Свежий деплой БД | пункт 2.2 на чистой БД | все 4 миграции применяются |
| Старт без БД | запустить сервер, БД выключена | retry подключения, понятная ошибка, затем выход для рестарта службой |

---

## 6. Очистка после тестов
```bash
docker rm -f belfproctor-pg
# остановить фоновые node-процессы сервера (Ctrl+C или Stop-Process)
```

---

## 7. Сводка «что покрыто»

- **Безопасность:** fail-fast секретов, path traversal, auth (юнит + E2E + ручной).
- **Устойчивость:** health 200/503, retry БД, graceful shutdown, компенсация файл↔БД.
- **Корректность данных:** retention всех таблиц, дедуп gap-сессий, ташкентский табель,
  idempotent uninstall.
- **Клиент:** сборка + 14 тестов; ручная эмуляция N клиентов.
- **Деплой:** свежий `migrate deploy` (критичный фикс порядка миграций).
