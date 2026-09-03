# BelfProctor: промышленное развёртывание на Windows Server и рабочих ПК

Версия инструкции: 2026-09-03  
Назначение: локальная установка BelfProctor в компании для непрерывной работы 24/7.  
Аудитория: системный администратор или агент автоматизации, имеющий законный административный доступ к серверу и рабочим станциям.

> Эта инструкция описывает поддерживаемую для данного репозитория схему. Не заменять отдельные шаги «похожими» командами, не отключать TLS и проверку цифровой подписи, не публиковать PostgreSQL или backend напрямую в сеть.

## 1. Результат, который должен быть получен

Рабочая схема:

```text
Рабочие ПК сотрудников
        |
        | исходящий HTTPS, TCP 443
        v
proctor.company.local (DNS)
        |
        v
Windows Server / Windows 11 Pro host
        |
        v
Hyper-V VM: Ubuntu Server 24.04 LTS, статический IP
        |
        v
Docker Engine + Docker Compose
        |
        +-- frontend/nginx : 80, 443
        +-- backend        : только внутренняя Docker-сеть, порт 4000
        +-- PostgreSQL     : только внутренняя Docker-сеть, порт 5432
```

На каждом рабочем ПК устанавливаются два процесса из одного подписанного `BelfProctor.exe`:

- служба Windows `BelfProctor` под `LocalSystem` — supervisor и фоновая связь;
- задача планировщика `BelfProctor-Desktop` в интерактивной сессии сотрудника — функции, которым нужен рабочий стол: снимки экранов, активность приложений, USB/WMI и live view.

Серверная часть и клиентский агент — разные компоненты. Клиентский агент на центральный сервер устанавливать не нужно, если сам сервер не должен быть объектом мониторинга.

## 2. Обязательные стоп-условия

Агент развёртывания обязан остановиться и исправить причину, если выполняется хотя бы одно условие:

- неизвестна точная редакция и версия Windows на сервере;
- нет резервной копии сервера либо согласованного окна для первого развёртывания;
- процессор/BIOS не поддерживает или не разрешает аппаратную виртуализацию;
- нет статического адреса или DHCP reservation для Linux VM;
- нет корпоративного DNS-имени и доверенного TLS-сертификата;
- сертификат не содержит DNS-имя сервера в SAN;
- клиенты не доверяют корневому центру сертификации;
- репозиторий содержит непроверенные изменения или не выбран конкретный commit/tag для выпуска;
- отсутствует настоящий сертификат подписи кода с закрытым ключом (`.pfx`);
- установщик, деинсталлятор или EXE не имеют статуса Authenticode `Valid`;
- для устройства заранее не созданы уникальные `ClientId` и `EncryptionKey`;
- установщик запускается под другой учётной записью, чем постоянная интерактивная учётная запись сотрудника;
- не утверждены правила мониторинга сотрудников, сроки хранения и круг администраторов с доступом к данным.

## 3. Почему сервер запускается в Linux VM

Текущий `server/docker-compose.yml` использует Linux-контейнеры: `postgres:16-alpine`, Node Alpine и nginx Alpine. Docker Desktop официально не поддерживается на Windows Server. Кроме того, запуск критического сервиса через пользовательскую сессию Docker Desktop неудобен для 24/7: он зависит от входа пользователя и состояния desktop-приложения.

Поэтому штатный вариант:

1. Windows остаётся Hyper-V host.
2. В Hyper-V постоянно работает Ubuntu Server VM.
3. В VM установлен официальный Docker Engine и Compose plugin.
4. Контейнеры имеют `restart: unless-stopped`, Docker запускается вместе с VM, VM запускается вместе с Windows host.

Для обычной Windows 11 Pro/Enterprise применяется та же схема. На Windows 11 Home роль Hyper-V штатно недоступна — такую систему нельзя принимать как production-host без смены редакции/ОС.

## 4. Что подготовить заранее

### 4.1. Данные инфраструктуры

Заполнить и сохранить в закрытом эксплуатационном журнале:

```text
Windows host name:       ______________________________
Windows host IP:         ______________________________
Точная версия Windows:   ______________________________
VM name:                 BelfProctor-Server
VM static IP:            ______________________________
Gateway:                 ______________________________
DNS servers:             ______________________________
FQDN приложения:         proctor.company.local
Админская подсеть SSH:   ______________________________
Git commit/tag релиза:   ______________________________
Место off-host backup:   ______________________________
Ответственный:           ______________________________
```

Не использовать IP-адрес в качестве постоянного `PUBLIC_BASE_URL` или `ServerUrl`: TLS, DNS и последующие переносы надёжнее работают с FQDN.

### 4.2. Ресурсы

Минимум для небольшой установки:

- физический host: 4 CPU cores, 16 GB RAM, SSD, аппаратная виртуализация;
- Ubuntu VM: 4 vCPU, 8 GB RAM, системный диск от 100 GB;
- отдельное место для резервных копий, не на том же физическом диске;
- UPS для сервера, сетевого оборудования и хранилища резервных копий.

Для десятков активных клиентов лучше начинать с 8 vCPU, 12–16 GB RAM и 250 GB SSD, затем корректировать по метрикам.

Приблизительная оценка места для снимков:

```text
клиенты × снимки_в_день × средний_размер_снимка × срок_хранения
```

Пример: 50 ПК × 96 снимков за 8-часовой день × 0,2 MB × 30 дней ≈ 29 GB только на снимки. Добавить базу, отчёты, обновления, Docker images, логи, запас не менее 30% и отдельный объём для backup.

## 5. Подготовка Windows host

Все команды этого раздела выполнять в PowerShell **от имени администратора**.

### 5.1. Определить ОС и ресурсы

```powershell
Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsBuildNumber
Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, VirtualizationFirmwareEnabled
Get-Volume | Select-Object DriveLetter, FileSystemLabel, SizeRemaining, Size
```

Если результат показывает Windows Server, не устанавливать Docker Desktop. Если это Windows 11, production-вариантом всё равно считать Hyper-V VM.

### 5.2. Установить Hyper-V

Для Windows Server:

```powershell
Install-WindowsFeature -Name Hyper-V -IncludeManagementTools -Restart
```

Для Windows 11 Pro/Enterprise:

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All
```

После перезагрузки:

```powershell
Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All
Get-Service vmms
```

Ожидается включённая роль и запущенная служба управления Hyper-V.

### 5.3. Сеть Hyper-V

Создать внешний виртуальный switch, привязанный к физическому сетевому адаптеру серверной LAN. При удалённой работе изменение switch может кратковременно оборвать соединение, поэтому делать это только в согласованное окно.

```powershell
Get-NetAdapter | Where-Object Status -eq 'Up'
New-VMSwitch -Name 'BelfProctor-LAN' -NetAdapterName '<ТОЧНОЕ_ИМЯ_NIC>' -AllowManagementOS $true
```

Если switch уже существует, не создавать второй:

```powershell
Get-VMSwitch
```

### 5.4. Создать Ubuntu VM

В Hyper-V Manager:

1. Скачать Ubuntu Server 24.04 LTS ISO с официального сайта Ubuntu и сверить SHA256.
2. Создать VM поколения 2 с именем `BelfProctor-Server`.
3. Подключить к `BelfProctor-LAN`.
4. Выделить 4 vCPU, 8 GB RAM и VHDX от 100 GB.
5. Для Secure Boot выбрать шаблон `Microsoft UEFI Certificate Authority`.
6. Установить минимальный Ubuntu Server и OpenSSH Server.
7. Не устанавливать графический рабочий стол: он не нужен и увеличивает поверхность атаки.
8. Задать статический IP либо DHCP reservation.
9. Проверить hostname, DNS, gateway и синхронизацию времени.

VM должна автоматически запускаться после host и корректно завершаться при его штатном выключении:

```powershell
Set-VM -Name 'BelfProctor-Server' `
  -AutomaticStartAction Start `
  -AutomaticStartDelay 60 `
  -AutomaticStopAction ShutDown
Get-VM -Name 'BelfProctor-Server' | Format-List Name,State,AutomaticStartAction,AutomaticStartDelay,AutomaticStopAction
```

Hyper-V checkpoint не является резервной копией PostgreSQL и не заменяет off-host backup.

## 6. Базовая настройка Ubuntu VM

Войти по консоли или SSH под отдельной административной учётной записью.

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y openssh-server ca-certificates curl unattended-upgrades
sudo systemctl enable --now ssh
sudo dpkg-reconfigure -plow unattended-upgrades
timedatectl
hostnamectl
ip address
ip route
resolvectl status
```

Правила:

- запретить прямой SSH login пользователя `root`;
- использовать ключи SSH, а не общий пароль;
- разрешить SSH только из администраторской VLAN/подсети;
- применять обновления ОС в согласованное окно; после обновления ядра выполнять контролируемую перезагрузку;
- не добавлять обычных пользователей в группу `docker`: эта группа практически эквивалентна root. В этой инструкции Docker вызывается через `sudo`.

## 7. Установка Docker Engine и Compose

Использовать официальный apt repository Docker, не случайный сторонний пакет и не convenience script.

```bash
sudo apt remove -y docker.io docker-compose docker-compose-v2 podman-docker containerd runc || true
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo \"${UBUNTU_CODENAME:-$VERSION_CODENAME}\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now containerd docker
sudo docker version
sudo docker compose version
sudo docker run --rm hello-world
```

### 7.1. Ограничить рост Docker logs

Открыть файл:

```bash
sudoedit /etc/docker/daemon.json
```

Содержимое:

```json
{
  "log-driver": "local",
  "log-opts": {
    "max-size": "20m",
    "max-file": "5"
  },
  "live-restore": true
}
```

Применить:

```bash
sudo dockerd --validate --config-file=/etc/docker/daemon.json
sudo systemctl restart docker
sudo systemctl is-enabled docker
sudo systemctl is-active docker
```

Драйвер `local` с ротацией нужен, чтобы stdout/stderr контейнеров не заняли весь диск.

## 8. DNS, TLS и firewall

### 8.1. DNS

Создать корпоративную DNS A-запись:

```text
proctor.company.local -> <СТАТИЧЕСКИЙ_IP_UBUNTU_VM>
```

С клиента и сервера проверить:

```powershell
Resolve-DnsName proctor.company.local
Test-NetConnection proctor.company.local -Port 443
```

### 8.2. TLS

Получить сертификат от корпоративного CA или публичного CA. Сертификат должен:

- содержать `proctor.company.local` в Subject Alternative Name;
- быть действующим по времени;
- иметь полную цепочку intermediate certificates;
- иметь соответствующий private key;
- быть представлен в PEM как `tls.crt` и `tls.key`.

Корневой сертификат внутреннего CA должен быть штатно развёрнут в `Local Computer > Trusted Root Certification Authorities` на всех клиентских ПК, предпочтительно через Group Policy. Не использовать `-SkipCertificateCheck`, `NODE_TLS_REJECT_UNAUTHORIZED=0` или HTTP как production-решение.

### 8.3. Сетевые правила

Разрешить к Ubuntu VM:

- TCP 443 от корпоративных клиентских сетей;
- TCP 80 только для редиректа на HTTPS, если он нужен;
- TCP 22 только от администраторской подсети.

Не разрешать извне TCP 4000 и 5432. В текущем Compose эти порты не опубликованы — не добавлять им секцию `ports`.

Docker изменяет iptables самостоятельно, поэтому не полагаться только на UFW. Ограничение источников продублировать на корпоративном firewall/VLAN. Если UFW используется, сначала разрешить текущий SSH-источник, затем включать firewall, иначе можно потерять удалённый доступ.

## 9. Размещение проекта на Ubuntu

Production должен быть привязан к проверенному commit/tag. Не запускать автоматически «последний main».

```bash
sudo mkdir -p /opt/belfproctor
sudo chown "$USER":"$USER" /opt/belfproctor
git clone <URL_РЕПОЗИТОРИЯ> /opt/belfproctor
cd /opt/belfproctor
git fetch --tags --prune
git checkout --detach <ПРОВЕРЕННЫЙ_COMMIT_ИЛИ_TAG>
git rev-parse HEAD
git status --short
```

Ожидается нужный commit и пустой `git status --short`.

При офлайн-переносе копировать только исходники выбранного релиза. Не переносить `node_modules`, `.artifacts`, старый `.env`, тестовые сертификаты и временные данные.

## 10. Настройка production environment

```bash
cd /opt/belfproctor/server
cp .env.example .env
mkdir -p tls backend/storage
chmod 700 tls backend/storage
sudoedit .env
```

Заполнить `.env`:

```dotenv
POSTGRES_DB=proctor
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<УНИКАЛЬНЫЙ_СЛУЧАЙНЫЙ_ПАРОЛЬ_БД>

JWT_SECRET=<УНИКАЛЬНАЯ_СЛУЧАЙНАЯ_СТРОКА_НЕ_МЕНЕЕ_48_БАЙТ>
PUBLIC_BASE_URL=https://proctor.company.local
DEFAULT_ADMIN_EMAIL=<ИМЯ_АДМИНИСТРАТОРА_ИЛИ_EMAIL>
DEFAULT_ADMIN_PASSWORD=<УНИКАЛЬНЫЙ_СИЛЬНЫЙ_ПАРОЛЬ>

HTTPS_PORT=443
HTTP_REDIRECT_PORT=80
TLS_CERT_FILE=./tls/tls.crt
TLS_KEY_FILE=./tls/tls.key

RETENTION_SCREENSHOTS_DAYS=30
RETENTION_APP_HISTORY_DAYS=30
RETENTION_COMMANDS_DAYS=7
RETENTION_ACTIVITY_DAYS=30
RETENTION_HEARTBEAT_DAYS=2

MAX_SCREENSHOT_BYTES=20971520
MAX_REPORT_BYTES=209715200
MAX_COMMAND_RESULT_BYTES=104857600
MAX_UPDATE_BYTES=524288000

FEATURE_UPDATE_V2=true
FEATURE_WORK_TRACKING=true
FEATURE_PROJECT_MAPPING=true
FEATURE_LIVE_VIEW=true
FEATURE_RULES_CLASSIFIER=true
LIVE_VIEW_MAX_STREAMS=10
```

Сгенерировать секреты можно командой `openssl rand -base64 48`, но не вставлять секреты в ticket, чат, историю команд или Git. Сохранить их в корпоративном password manager. Значения не должны содержать перенос строк.

Важно:

- `PUBLIC_BASE_URL` — адрес сайта без `/api`;
- клиентский `ServerUrl` — этот же адрес с `/api`: `https://proctor.company.local/api`;
- изменение `DEFAULT_ADMIN_PASSWORD` после первого создания БД не обязательно изменит уже созданную запись администратора; обращаться с первым паролем как с реальным production credential;
- каждому ПК выдаётся свой ключ устройства; общий ключ для отдела запрещён.

Установить сертификат:

```bash
sudo install -o root -g root -m 0644 /path/to/corporate-fullchain.pem /opt/belfproctor/server/tls/tls.crt
sudo install -o root -g root -m 0600 /path/to/corporate-private-key.pem /opt/belfproctor/server/tls/tls.key
chmod 600 /opt/belfproctor/server/.env
```

Проверить сертификат и private key до запуска:

```bash
openssl x509 -in tls/tls.crt -noout -subject -issuer -dates -ext subjectAltName
openssl x509 -in tls/tls.crt -pubkey -noout | sha256sum
openssl pkey -in tls/tls.key -pubout | sha256sum
```

Последние два SHA256 должны совпасть.

## 11. Первый запуск сервера

```bash
cd /opt/belfproctor/server
sudo docker compose config -q
sudo docker compose pull
sudo docker compose build --pull
sudo docker compose up -d --wait
sudo docker compose ps
sudo docker compose exec backend ./node_modules/.bin/prisma migrate status
```

Ожидается:

- `db`, `backend`, `frontend` запущены;
- `db` и `backend` имеют healthy status;
- миграции находятся в актуальном состоянии;
- frontend публикует только 80/443.

Проверки из VM:

```bash
curl -I http://proctor.company.local
curl --fail --show-error https://proctor.company.local/api/health
sudo ss -lntp
```

HTTP должен перенаправляться на HTTPS. Health endpoint должен ответить без обхода проверки сертификата. В `ss` не должно быть внешнего listener на 4000/5432.

Проверки с отдельного Windows ПК:

```powershell
Resolve-DnsName proctor.company.local
Test-NetConnection proctor.company.local -Port 443
Invoke-WebRequest -UseBasicParsing 'https://proctor.company.local/api/health'
```

Затем открыть `https://proctor.company.local`, войти как администратор и убедиться, что интерфейс загружается без предупреждения TLS.

## 12. Почему сервис переживает перезагрузки

Цепочка автозапуска:

1. Windows host загружается.
2. Hyper-V автоматически запускает `BelfProctor-Server` через 60 секунд.
3. systemd автоматически запускает Docker.
4. Compose-контейнеры с `restart: unless-stopped` автоматически поднимаются.
5. healthcheck не позволяет frontend стартовать раньше здорового backend.

`unless-stopped` не поднимет контейнер, который администратор намеренно остановил. Поэтому после обслуживания всегда проверять `sudo docker compose ps` и явно выполнять `sudo docker compose up -d --wait`.

## 13. Ежедневный контроль и мониторинг

Минимум один внешний монитор должен каждую минуту проверять:

- DNS resolve;
- TCP 443;
- `GET /api/health`;
- срок TLS-сертификата;
- свободное место;
- состояние VM и контейнеров.

Рекомендуемые пороги диска:

- 70% — предупреждение;
- 80% — срочное расследование;
- 90% — критический инцидент и остановка тяжёлых загрузок/обновлений.

Команды дежурного администратора:

```bash
cd /opt/belfproctor/server
sudo docker compose ps
sudo docker compose logs --since=30m --tail=300
sudo docker inspect --format '{{.Name}} restart={{.RestartCount}} state={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{end}}' $(sudo docker compose ps -q)
df -h
du -sh backend/storage
sudo docker system df
systemctl --failed
journalctl -u docker --since '1 hour ago' --no-pager
```

Не применять `docker system prune -a` как регулярную «очистку»: сначала определить, что именно занимает место, и сохранить образы, нужные для rollback.

## 14. Резервное копирование

### 14.1. Что обязательно сохранять

- логический dump PostgreSQL;
- `/opt/belfproctor/server/backend/storage`;
- `/opt/belfproctor/server/.env` в зашифрованном и ограниченном хранилище;
- TLS certificate/private key либо документированный способ их перевыпуска;
- точный Git commit/tag;
- release package клиентского агента и его manifest, но не publisher PFX.

Тома/данные сервера:

- PostgreSQL находится в Docker named volume `pgdata`;
- загрузки backend находятся в bind mount `server/backend/storage`.

Не выполнять `docker compose down -v`: ключ `-v` удалит named volume PostgreSQL.

### 14.2. Ежедневный online backup

На отдельном backup volume создать root-only script через:

```bash
sudoedit /usr/local/sbin/backup-belfproctor
```

Содержимое:

```bash
#!/usr/bin/env bash
set -euo pipefail
umask 077

PROJECT_DIR=/opt/belfproctor
BACKUP_ROOT=/backup/belfproctor
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
RUN_DIR="$BACKUP_ROOT/$STAMP"

mkdir -p "$RUN_DIR"
cd "$PROJECT_DIR/server"

docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  | gzip -9 > "$RUN_DIR/postgres.sql.gz"

tar -C "$PROJECT_DIR/server/backend" -czf "$RUN_DIR/storage.tar.gz" storage
install -m 0600 .env "$RUN_DIR/server.env"
git -C "$PROJECT_DIR" rev-parse HEAD > "$RUN_DIR/source-commit.txt"
sha256sum "$RUN_DIR"/* > "$RUN_DIR/SHA256SUMS"

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf -- {} +
```

Активировать:

```bash
sudo chmod 700 /usr/local/sbin/backup-belfproctor
sudo mkdir -p /backup/belfproctor
sudo chmod 700 /backup/belfproctor
sudo /usr/local/sbin/backup-belfproctor
sudo ls -lah /backup/belfproctor
```

Папка `/backup` должна быть отдельным защищённым хранилищем или её содержимое должно немедленно реплицироваться off-host. Копия только на диске той же VM не является резервной копией.

Online dump PostgreSQL консистентен для БД. Архив файлов создаётся параллельно с работающим backend, поэтому для строго согласованной пары БД+файлы периодически делать coordinated backup в короткое окно низкой активности: остановить `backend`, выполнить dump и архив storage, затем `docker compose up -d --wait`.

Минимальная политика: ежедневная копия, 14 ежедневных точек, 8 недельных, 12 месячных; одна копия offline/off-site. Подстроить под требования компании и объём.

### 14.3. Проверка восстановления

Не считать backup рабочим, пока восстановление не проверено на отдельной изолированной VM. Как минимум ежеквартально:

1. Создать чистую test VM без доступа клиентов.
2. Развернуть тот же commit.
3. Поднять только чистый `db`.
4. Восстановить PostgreSQL dump и `backend/storage`.
5. Поднять весь Compose.
6. Проверить login, client records, screenshots, reports и health.
7. Зафиксировать дату, длительность и результат.

Удаление/пересоздание production БД — разрушительная операция; не выполнять команды restore на production без подтверждённого rollback plan и отдельной копии текущего состояния.

## 15. Плановое обновление сервера

1. Назначить окно и уведомить ответственных.
2. Выполнить и проверить backup.
3. Записать текущий commit и список images:

```bash
cd /opt/belfproctor
git rev-parse HEAD
cd server
sudo docker compose images
```

4. Перейти на заранее проверенный tag/commit:

```bash
cd /opt/belfproctor
git fetch --tags --prune
git checkout --detach <НОВЫЙ_ПРОВЕРЕННЫЙ_COMMIT_ИЛИ_TAG>
git status --short
cd server
sudo docker compose config -q
sudo docker compose build --pull
sudo docker compose up -d --wait
sudo docker compose exec backend ./node_modules/.bin/prisma migrate status
sudo docker compose ps
curl --fail --show-error https://proctor.company.local/api/health
```

После миграции БД простой возврат старого кода может быть несовместим со схемой. Rollback выполнять только по release plan: предыдущий commit, совместимые миграции либо полное восстановление проверенного backup.

Обновления Ubuntu/Docker сначала проверять на test VM, затем ставить на production в окно. После перезагрузки повторять полный health check.

## 16. Подготовка production-релиза клиента

Собирать клиент на защищённой Windows build workstation, не на ПК сотрудника. Нужны:

- .NET SDK, требуемый файлом проекта;
- Git;
- настоящий certificate for code signing с закрытым ключом в PFX;
- доступ к RFC3161 timestamp server;
- чистое рабочее дерево Git;
- выбранный проверенный commit.

PFX и его пароль нельзя копировать на Ubuntu server, файловую шару общего доступа или рабочие ПК сотрудников.

В PowerShell из корня репозитория:

```powershell
git status --short
git rev-parse HEAD
$pfxPassword = Read-Host 'PFX password' -AsSecureString
& .\client\build-release.ps1 `
  -PfxPath 'C:\Secure\BelfProctor-CodeSigning.pfx' `
  -PfxPassword $pfxPassword
```

Результат:

```text
.artifacts\release\agent-win-x64\
.artifacts\release\BelfProctor-agent-win-x64.zip
```

Проверить:

```powershell
$release = '.\.artifacts\release\agent-win-x64'
Get-AuthenticodeSignature "$release\BelfProctor.exe" | Format-List Status,StatusMessage,SignerCertificate
Get-AuthenticodeSignature "$release\install-windows-service.ps1" | Format-List Status,SignerCertificate
Get-AuthenticodeSignature "$release\uninstall-windows-service.ps1" | Format-List Status,SignerCertificate
Get-Content "$release\release-manifest.json"
Get-FileHash '.\.artifacts\release\BelfProctor-agent-win-x64.zip' -Algorithm SHA256
```

У всех трёх подписанных файлов статус должен быть `Valid`, thumbprint — один и тот же, `sourceState` в manifest — `clean`, `sourceCommit` — утверждённый commit.

Флаги `-AllowUntrustedEphemeralTestCertificate` и `-AllowDirtyWorkingTree` предназначены только для pipeline test и запрещены в production.

## 17. Регистрация каждого клиентского ПК

До установки войти в административный web UI и создать отдельного клиента для каждого компьютера. Записать:

```text
Asset/hostname:       PC-ACCOUNTING-07
Assigned user:        COMPANY\employee
ClientId:             <уникальный ID>
EncryptionKey:        <уникальный секрет, не менее 32 символов>
Signer thumbprint:    <40 hex символов без пробелов>
Release SHA256:       <SHA256 ZIP>
Install date:         __________________
```

`ClientId` и `EncryptionKey` на сервере и ПК должны совпадать. Ключ каждого ПК хранить как секрет. Не отправлять его в общий мессенджер и не использовать один ключ на нескольких устройствах.

## 18. Установка клиента на рабочий ПК

### 18.1. Предварительные условия

- поддерживаемая корпоративная Windows x64 с актуальными security updates;
- ПК имеет правильные дату, время и DNS;
- корпоративный root CA установлен в хранилище Local Computer;
- исходящий TCP 443 к `proctor.company.local` разрешён;
- сотрудник работает под назначенной постоянной Windows-учётной записью;
- установка и мониторинг одобрены политикой компании.

Проверить до установки:

```powershell
whoami
Resolve-DnsName proctor.company.local
Test-NetConnection proctor.company.local -Port 443
Invoke-WebRequest -UseBasicParsing 'https://proctor.company.local/api/health'
```

### 18.2. Критичное ограничение интерактивной учётной записи

Текущий подписанный installer создаёт `BelfProctor-Desktop` для identity, под которой запущен elevated PowerShell. Поэтому:

- войти в Windows именно под постоянной учётной записью сотрудника;
- повысить права этой же сессии и убедиться, что `whoami` в elevated PowerShell указывает на нужную учётную запись;
- не устанавливать из `SYSTEM`, Intune/SCCM system context или под отдельной временной admin identity без предварительно проверенного изменения установщика.

Если UAC требует credentials другой администраторской учётной записи, текущая версия привяжет задачу к администратору, а не сотруднику. Это стоп-условие релиза. Нельзя обходить его ручной неподписанной правкой задачи. Для таких организаций нужен отдельный подписанный installer enhancement с явным целевым SID и его тестирование.

Текущая схема также не предназначена для общего RDS/терминального сервера или ПК, где постоянно работают разные пользователи. Такой сценарий требует отдельной архитектуры и проверки.

### 18.3. Проверка пакета и запуск

Скопировать ZIP локально в защищённую временную папку, сверить SHA256 с журналом релиза, распаковать. В elevated PowerShell:

```powershell
$releaseDir = 'C:\Temp\BelfProctor-agent-win-x64'
Set-Location $releaseDir

Get-AuthenticodeSignature '.\BelfProctor.exe'
Get-AuthenticodeSignature '.\install-windows-service.ps1'
Get-AuthenticodeSignature '.\uninstall-windows-service.ps1'
$manifest = Get-Content '.\release-manifest.json' -Raw | ConvertFrom-Json
$manifest | Format-List product,version,sourceCommit,sourceState,signerThumbprint,builtAtUtc
```

Убедиться, что все подписи `Valid`, а manifest соответствует утверждённому релизу. Затем:

```powershell
$thumbprint = '<40_HEX_СИМВОЛОВ_ИЗ_RELEASE_MANIFEST>'
$clientId = '<CLIENT_ID_ЭТОГО_ПК>'
$encryptionKey = Read-Host 'Unique device encryption key'

Set-ExecutionPolicy -Scope Process -ExecutionPolicy AllSigned -Force
& '.\install-windows-service.ps1' `
  -ServerUrl 'https://proctor.company.local/api' `
  -ClientId $clientId `
  -EncryptionKey $encryptionKey `
  -TrustedUpdateSignerThumbprint $thumbprint
```

Установщик сам:

- проверит HTTPS URL, уникальные credentials и thumbprint;
- проверит Authenticode у installer, EXE и uninstaller;
- установит в фиксированную папку `%ProgramFiles%\BelfProctor`;
- создаст конфигурацию с ограниченными ACL;
- создаст автоматическую службу `BelfProctor` и recovery actions;
- создаст `BelfProctor-Desktop` для входа интерактивного пользователя;
- запустит оба компонента и проверит desktop process;
- удалит legacy startup mechanisms после успешного старта;
- при ошибке попытается откатить предыдущую установку.

После успеха удалить распакованный пакет и ZIP из пользовательской папки. Production PFX там находиться не должен изначально.

## 19. Почему клиент не должен мешать сотруднику

Production installer задаёт консервативные значения:

- `ScreenshotIntervalMs=300000` — не чаще одного снимка в 5 минут;
- `ScreenshotQuality=75`;
- `HeartbeatIntervalMs=60000`;
- startup jitter до 30 секунд, чтобы ПК не создавали одновременный пик;
- `MonitorNetwork=false`;
- `BrowserActivity=false`;
- `BlockedProcesses=[]` и `AllowedProcesses=[]`;
- логи ограничены по размеру;
- основной desktop process запускается через задачу, а не видимое приложение в автозагрузке.

Не добавлять процессы в block list без отдельного утверждения и пилота. Текущий policy code фиксирует нарушения, но эксплуатационная политика должна оставаться наблюдательной, если компания не утвердила иное.

Не отключать Microsoft Defender и не создавать исключение на всю папку `%ProgramFiles%\BelfProctor`. Если возникает false positive, сначала проверить Authenticode/hash и отправить образец поставщику защиты; временное точечное исключение возможно только с одобрения службы безопасности.

Клиентам нужен только исходящий HTTPS 443 к FQDN. Входящие порты на рабочих ПК открывать не требуется.

## 20. Проверка клиента после установки

```powershell
Get-Service -Name BelfProctor | Format-List Name,Status,StartType
Get-ScheduledTask -TaskName BelfProctor-Desktop | Format-List TaskName,State
Get-ScheduledTaskInfo -TaskName BelfProctor-Desktop
sc.exe qfailure BelfProctor

Get-CimInstance Win32_Service -Filter "Name='BelfProctor'" |
  Select-Object Name,State,StartMode,StartName,PathName

Get-CimInstance Win32_Process -Filter "Name='BelfProctor.exe'" |
  Select-Object ProcessId,SessionId,ExecutablePath,CommandLine

Get-ChildItem 'C:\ProgramData\BelfProctor\Install' -Force
Get-Content 'C:\ProgramData\BelfProctor\Install\install.log' -Tail 200
```

Ожидается:

- служба `Running`, `Automatic`, `LocalSystem`, путь только из `%ProgramFiles%\BelfProctor` с `--service-host`;
- задача существует и работает для нужного сотрудника;
- один process находится в Session 0 как service host;
- второй process находится в интерактивной session > 0 и запущен с `--auto-start`;
- в web UI клиент появляется online, heartbeat обновляется;
- после первого интервала появляется снимок экрана;
- ошибки TLS/authentication отсутствуют.

Провести обязательный reboot test:

1. Перезагрузить рабочий ПК.
2. До входа пользователя проверить, что служба запустилась.
3. Войти под сотрудником.
4. Проверить, что scheduled task и desktop process запустились без окна/UAC prompt.
5. Проверить новый heartbeat и снимок в web UI.
6. В течение рабочего дня проверить CPU, RAM, disk и субъективное влияние на сотрудника.

## 21. Поэтапное внедрение

Не ставить новый релиз сразу на весь парк:

1. Один test PC, не содержащий критичных данных.
2. Один canary PC реального пользователя на 24–48 часов.
3. 5–10% парка на 2 рабочих дня.
4. Остальные ПК партиями.

После каждой стадии проверить crashes, перезапуски, CPU/RAM, рост диска, heartbeat, screenshots, offline recovery, logout/login и reboot. При ухудшении остановить rollout и сохранить логи/версию/hash.

Для обновления клиента использовать только publisher-signed release с тем же доверенным thumbprint. Новый сертификат подписи требует заранее спланированной ротации доверия; простая замена сертификата приведёт к отклонению update.

## 22. Деинсталляция клиента

Выполнять из `%ProgramFiles%\BelfProctor` в elevated PowerShell. Сначала проверить подпись:

```powershell
Set-Location "$env:ProgramFiles\BelfProctor"
Get-AuthenticodeSignature '.\uninstall-windows-service.ps1'
Set-ExecutionPolicy -Scope Process -ExecutionPolicy AllSigned -Force
& '.\uninstall-windows-service.ps1'
```

После деинсталляции проверить отсутствие службы, scheduled task и processes. Удаление записи устройства и исторических данных на сервере — отдельная операция в соответствии с retention/privacy policy.

## 23. Типовые неисправности

| Симптом | Наиболее вероятная причина | Что проверить |
|---|---|---|
| Браузер/клиент не доверяет HTTPS | неверная цепочка, SAN, root CA или время | `openssl x509`, Windows certificate store, DNS, часы |
| `401/403`, клиент offline | `ClientId`/ключ не совпадает с сервером | запись устройства, пробелы при копировании, уникальность ключа |
| Служба работает, снимков нет | desktop task назначена другому пользователю либо нет интерактивной сессии | principal/trigger задачи, `SessionId`, `--auto-start` |
| После reboot сайт не поднялся | VM/Docker/container был остановлен вручную или сломан autostart | `Get-VM`, `systemctl status docker`, `docker compose ps` |
| Backend unhealthy | БД не готова, неверный `.env`, миграция или нехватка места | `docker compose logs backend db`, migration status, `df -h` |
| Диск быстро заполняется | storage/retention/backups/logs | `du`, `docker system df`, retention; не удалять volume |
| Update клиента отклонён | подпись или thumbprint не совпадает | Authenticode, manifest, timestamp, trusted thumbprint |
| После установки появляется окно/UAC | desktop task создана неверно или приложение запущено вручную | task action `--auto-start`, installer identity |
| Live view недоступен | нет интерактивной сессии, TLS/WebSocket/firewall | desktop process, 443, proxy/WebSocket, server logs |

## 24. Запрещённые действия

- Не использовать Docker Desktop на Windows Server для production.
- Не запускать production из пользовательского терминала командой, которая умрёт после logout.
- Не публиковать backend 4000 или PostgreSQL 5432 в LAN/Internet.
- Не отключать TLS validation и не оставлять самоподписанный leaf certificate недоверенным.
- Не хранить `.env`, device keys или PFX в Git.
- Не копировать publisher PFX на сервер или рабочие станции.
- Не использовать один `EncryptionKey` для нескольких ПК.
- Не выполнять `docker compose down -v`.
- Не обновляться автоматически с непроверенной ветки.
- Не запускать unsigned installer/uninstaller и не править их после подписи.
- Не устанавливать клиента под временной admin identity, если сотрудник входит под другой учётной записью.
- Не разворачивать текущий клиент на shared/RDS host без отдельной проверки.
- Не отключать антивирус и firewall ради «чтобы заработало».
- Не считать Hyper-V checkpoint или копию на том же диске полноценным backup.

## 25. Приёмка 24/7

Развёртывание считается завершённым только после заполнения всех пунктов:

### Сервер

- [ ] Точная ОС/версия host записана.
- [ ] Hyper-V включён и обновлён.
- [ ] VM имеет статический адрес/reservation и правильный DNS/NTP.
- [ ] VM auto-start и graceful shutdown настроены.
- [ ] Docker Engine/Compose установлены из официального repository.
- [ ] Docker service enabled, log rotation настроена.
- [ ] Используется проверенный commit/tag, рабочее дерево чистое.
- [ ] `.env` и TLS private key имеют ограниченные права.
- [ ] TLS доверен без bypass на отдельном клиентском ПК.
- [ ] В LAN доступны только 80/443; 4000/5432 не опубликованы.
- [ ] Все контейнеры healthy, миграции актуальны.
- [ ] После reboot Windows host VM и stack поднялись автоматически.
- [ ] Внешний health monitor и disk alerts работают.
- [ ] Daily off-host backup работает.
- [ ] Test restore успешно выполнен и документирован.
- [ ] Выполнен минимум 24-часовой soak без необъяснимых restarts/errors.

### Каждый клиент

- [ ] Есть отдельные `ClientId` и `EncryptionKey`.
- [ ] Release подписан production certificate, `sourceState=clean`.
- [ ] ZIP hash сверен.
- [ ] Root CA и DNS настроены, HTTPS health проходит.
- [ ] Installer запущен под правильной интерактивной identity.
- [ ] Служба `BelfProctor` работает и имеет recovery actions.
- [ ] `BelfProctor-Desktop` работает в session сотрудника.
- [ ] В web UI обновляются heartbeat и screenshots.
- [ ] Reboot/login/logout test пройден.
- [ ] На canary не выявлено заметного влияния на работу.
- [ ] Сотрудник уведомлён согласно утверждённой политике.

## 26. Эксплуатационная и правовая часть

BelfProctor обрабатывает чувствительные данные о действиях и экранах сотрудников. До production-включения компания должна определить:

- законное основание и цель мониторинга;
- какие категории сотрудников/устройств охвачены;
- прозрачное уведомление сотрудников;
- минимально необходимый набор данных;
- сроки хранения;
- роли, имеющие доступ к screenshots/live view/reports;
- журналирование административного доступа;
- процедуру инцидента и удаления данных;
- требования местного трудового законодательства и законодательства о персональных данных.

Техническая возможность сбора данных не является разрешением собирать их без организационного и правового основания.

## 27. Официальные справочные материалы

- Docker Desktop on Windows: <https://docs.docker.com/desktop/setup/install/windows-install/>
- Docker Windows FAQ / Windows Server support: <https://docs.docker.com/desktop/troubleshoot-and-support/faqs/windowsfaqs/>
- Microsoft: Install Hyper-V: <https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/install-hyper-v>
- Microsoft: Create a Hyper-V virtual switch: <https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/create-a-virtual-switch-for-hyper-v-virtual-machines>
- Docker Engine on Ubuntu: <https://docs.docker.com/engine/install/ubuntu/>
- Docker Compose plugin: <https://docs.docker.com/compose/install/linux/>
- Docker restart policies: <https://docs.docker.com/engine/containers/start-containers-automatically/>
- Docker logging drivers: <https://docs.docker.com/engine/logging/configure/>
- Docker volumes and backups: <https://docs.docker.com/engine/storage/volumes/>
- Ubuntu automatic security updates: <https://ubuntu.com/server/docs/how-to/software/automatic-updates/>

## 28. Краткая команда для следующего агента

Следующий агент должен:

1. Прочитать этот файл полностью.
2. Заполнить инфраструктурные значения из раздела 4.
3. Проверить все стоп-условия раздела 2.
4. Развернуть сервер строго по разделам 5–15.
5. Не переходить к массовой установке до успешного backup/restore и 24-hour soak.
6. Собрать клиент только с production code-signing PFX и clean Git state.
7. Зарегистрировать и установить один canary по разделам 16–20.
8. Проверить identity scheduled task, reboot, heartbeat и отсутствие влияния на пользователя.
9. Масштабировать партиями по разделу 21.
10. Передать заполненный checklist, hashes, commit, backup/restore report и список исключений ответственному администратору.

Если хотя бы один обязательный пункт невозможно подтвердить, агент обязан сообщить конкретный блокер и не объявлять систему готовой к 24/7 production.
