# BelfProctor

Система прокторинга: клиент-агент (C#) + сервер (Node.js/Express + Prisma + PostgreSQL) + админ-панель (Vite/React + Refine + Ant Design).

## Структура репозитория
- `client/` — .NET сервис агента: сбор скриншотов, событий, heartbeat, отчётов, шифрование и отправка на сервер.
- `server/backend/` — Express API, Prisma, маршруты: `auth`, `clients`, `events`, `heartbeat`, `screenshots`, `reports`, `policies`.
- `server/frontend/` — админ-панель на React/Refine, ресурсы: клиенты, события, heartbeat, скриншоты, отчёты, политики.
- `server/docker-compose.yml` — запуск БД, бэкенда и фронта в контейнерах.

## Быстрый запуск (Docker Compose)
Требуется установленный и запущенный Docker.

```bash
cd server
docker compose up -d
```
- Production endpoint: `https://localhost/` (admin, `/api`, and WSS through nginx).
- Backend and PostgreSQL are private Compose-network services.

Примечания:
- Бэкенд при старте выполнит `prisma migrate deploy` и создаст директории для хранения файлов.
- Учтите переменные окружения в `docker-compose.yml` (JWT секрет, admin учётка, `UPLOAD_DIR`).

## Локальная разработка (без Docker)
Требуется Node.js 22.22.2+ (major 22) из `.nvmrc`; неподдерживаемая версия останавливается
preflight-проверкой до сборки или тестов.

1) Установите и запустите PostgreSQL, создайте БД `proctor` (user/pass `postgres/postgres`).
2) Проверьте `server/backend/.env` (уберите кавычки, если они есть):
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/proctor?schema=public
PORT=4000
JWT_SECRET=generate_a_unique_random_value_of_at_least_32_bytes
UPLOAD_DIR=storage
DEFAULT_ADMIN_EMAIL=admin@example.com
DEFAULT_ADMIN_PASSWORD=choose_a_unique_strong_password
```
3) Бэкенд:
```bash
cd server/backend
npm i
npm run prisma:migrate   # применить миграции (или npx prisma migrate dev)
npm run dev              # старт сервера на http://localhost:4000
```
4) Фронтенд:
```bash
cd server/frontend
npm i
npm run dev              # Vite на http://localhost:5173
```
Опционально: задать `VITE_API_URL=http://localhost:4000/api` в окружении фронта.

## Аутентификация
- Логин: `POST /api/auth/login` с `email` и `password`.
- При успешной аутентификации сервер устанавливает `HttpOnly; Secure; SameSite=Strict` session cookie; JWT недоступен JavaScript.
- Админ-учётка берётся из переменных окружения при старте бэкенда.

## Основные эндпоинты
- `GET /api/clients` — список клиентов.
- `POST /api/clients` — регистрация/обновление клиента и ключа шифрования.
- `POST /api/events` — приём зашифрованных событий.
- `GET /api/events` — список событий (пагинация, фильтры).
- `POST /api/heartbeat` — приём зашифрованного heartbeat.
- `GET /api/heartbeat` — список heartbeat.
- `POST /api/screenshots` — загрузка зашифрованных скриншотов.
- `GET /api/screenshots` — список скриншотов; `GET /api/screenshots/:id/file` — отдача файла.
- `POST /api/reports` — загрузка зашифрованных отчётов.
- `GET /api/reports` — список отчётов; `GET /api/reports/:id/file` — отдача файла.
- `GET /api/policies` — список политик; `GET /api/policies/download` — загрузка политики для клиента (шифрована ключом клиента).

## Шифрование
- Новые payloads используют versioned envelope `BPG1`: PBKDF2-SHA256 (210 000 итераций, случайная соль) и AES-256-GCM.
- Каждое устройство получает отдельный credential; production отвергает global/default credentials и изменённые AEAD payloads.
- Legacy AES-CBC поддерживается только на чтение для контролируемой миграции старой offline queue.

## Частые проблемы
- "Can't reach database server": запустите PostgreSQL локально или Docker.
- Prisma Client не сгенерирован: выполните `npm run prisma:generate` в `server/backend`.
- Vite ошибка экспорта `notificationProvider`: уже устранено, импорт удалён.
