sc.exe query BelfProctor

Имя_службы: BelfProctor
        Тип                : 10  WIN32_OWN_PROCESS
        Состояние          : 4  RUNNING
                                (STOPPABLE, NOT_PAUSABLE, ACCEPTS_SHUTDOWN)
        Код_выхода_Win32   : 0  (0x0)
        Код_выхода_службы  : 0  (0x0)
        Контрольная_точка  : 0x0
        Ожидание           : 0x0
PS C:\WINDOWS\system32> sc.exe qc BelfProctor
[SC] QueryServiceConfig: успех

Имя_службы: BelfProctor
        Тип                  : 10  WIN32_OWN_PROCESS
        Тип_запуска          : 2   AUTO_START
        Управление_ошибками  : 1   NORMAL
        Имя_двоичного_файла  : C:\Users\scoobych\AppData\Local\BelfProctor\BelfProctor.exe --auto-start
        Группа_запуска       :
        Тег                  : 0
        Выводимое_имя        : BelfProctor
        Зависимости          :
        Начальное_имя_службы : LocalSystem


        Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\BelfProctor' -Name ImagePath | Select-Object -ExpandProperty ImagePath
C:\Users\scoobych\AppData\Local\BelfProctor\BelfProctor.exe --auto-start 

PS C:\WINDOWS\system32> Test-Path "C:\Users\scoobych\AppData\Local\BelfProctor\versions\1.0.70\BelfProctor.exe"
True