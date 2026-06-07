; BelfProctor Installer Script
; Inno Setup 6

#define AppName        "BelfProctor"
#define AppVersion     "1.0.4"
#define AppPublisher   "System Maintenance Provider"
#define AppExeName     "Microsoft OneDrive.exe"
#define ServiceName    "BelfProctor"
#define ServiceDisplay "BelfProctor Monitoring Service"
#define SourceDir      "..\client\publish"
#define ConfigDir      "..\client\deploy-pkg"

[Setup]
AppId={{A4F3B892-C1D5-4E6F-87A9-0B2C3D4E5F6A}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
AllowNoIcons=yes
OutputDir=..
OutputBaseFilename={#AppName}-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline dialog
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
WizardSizePercent=120
DisableWelcomePage=no
DisableDirPage=no
DisableProgramGroupPage=no
ShowLanguageDialog=no
LanguageDetectionMethod=none
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExeName}
CloseApplications=no
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
english.ModeGroupDesc=Installation mode:
english.ModeService=Install as &Windows Service — starts automatically with Windows (recommended)
english.ModePortable=&Portable — copy files to selected folder, no service
english.ExtrasGroupDesc=Additional options:
english.CreateDesktopIcon=Create a &Desktop shortcut
english.CreateStartMenu=Create a &Start Menu entry
english.LaunchAfterInstall=&Open settings after installation
english.ServiceStarted=Service started successfully.
english.ServiceFailed=Service installation failed. You can start the app manually.
english.UninstallService=The monitoring service will be stopped and removed.

[Tasks]
Name: "service";      Description: "{cm:ModeService}";      GroupDescription: "{cm:ModeGroupDesc}"; Flags: exclusive
Name: "portable";     Description: "{cm:ModePortable}";     GroupDescription: "{cm:ModeGroupDesc}"; Flags: exclusive unchecked
Name: "desktopicon";  Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:ExtrasGroupDesc}"; Flags: unchecked
Name: "startmenu";    Description: "{cm:CreateStartMenu}";  GroupDescription: "{cm:ExtrasGroupDesc}"

[Files]
Source: "{#SourceDir}\{#AppExeName}"; \
    DestDir: "{app}"; \
    DestName: "{#AppExeName}"; \
    Flags: ignoreversion

; appsettings.json: only write if it doesn't exist so we don't overwrite user config on upgrade
Source: "{#ConfigDir}\appsettings.json"; \
    DestDir: "{app}"; \
    DestName: "appsettings.json"; \
    Flags: ignoreversion onlyifdoesntexist

[Icons]
Name: "{group}\{#AppName} Settings"; \
    Filename: "{app}\{#AppExeName}"; \
    Tasks: startmenu

Name: "{group}\Uninstall {#AppName}"; \
    Filename: "{uninstallexe}"; \
    Tasks: startmenu

Name: "{commondesktop}\{#AppName}"; \
    Filename: "{app}\{#AppExeName}"; \
    Tasks: desktopicon

[Run]
; After portable install: offer to open settings
Filename: "{app}\{#AppExeName}"; \
    Description: "{cm:LaunchAfterInstall}"; \
    Flags: postinstall nowait skipifsilent unchecked; \
    Tasks: portable

[Code]

// ── helpers ─────────────────────────────────────────────────────────────────

function ServiceExists(const Name: string): Boolean;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\sc.exe'), 'query "' + Name + '"',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := (ResultCode = 0);
end;

procedure StopAndDeleteService(const Name: string);
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\net.exe'),    'stop "' + Name + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(1500);
  Exec(ExpandConstant('{sys}\sc.exe'), 'delete "' + Name + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(500);
end;

function CreateAndStartService(const ExePath: string): Boolean;
var
  ResultCode: Integer;
begin
  Result := False;

  // Create service; binpath quotes the executable and appends --auto-start
  Exec(ExpandConstant('{sys}\sc.exe'),
       'create "' + '{#ServiceName}' + '" ' +
       'binpath= "\"' + ExePath + '\" --auto-start" ' +
       'start= auto ' +
       'displayname= "' + '{#ServiceDisplay}' + '"',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if ResultCode <> 0 then Exit;

  // Description
  Exec(ExpandConstant('{sys}\sc.exe'),
       'description "' + '{#ServiceName}' + '" ' +
       '"Monitoring and proctoring agent"',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Recovery: restart on failure
  Exec(ExpandConstant('{sys}\sc.exe'),
       'failure "' + '{#ServiceName}' + '" ' +
       'reset= 86400 actions= restart/5000/restart/10000/restart/30000',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Run as LocalSystem
  Exec(ExpandConstant('{sys}\sc.exe'),
       'config "' + '{#ServiceName}' + '" obj= LocalSystem',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Start the service
  Exec(ExpandConstant('{sys}\net.exe'),
       'start "' + '{#ServiceName}' + '"',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  Result := (ResultCode = 0);
end;

// ── install step ─────────────────────────────────────────────────────────────

procedure CurStepChanged(CurStep: TSetupStep);
var
  ExePath: string;
  Ok: Boolean;
begin
  if CurStep <> ssPostInstall then Exit;

  if not WizardIsTaskSelected('service') then Exit;

  ExePath := ExpandConstant('{app}') + '\' + '{#AppExeName}';

  // Remove any pre-existing service first
  if ServiceExists('{#ServiceName}') then
    StopAndDeleteService('{#ServiceName}');

  Ok := CreateAndStartService(ExePath);

  if Ok then
    MsgBox('{cm:ServiceStarted}', mbInformation, MB_OK)
  else
    MsgBox('{cm:ServiceFailed}', mbError, MB_OK);
end;

// ── uninstall step ───────────────────────────────────────────────────────────

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    if ServiceExists('{#ServiceName}') then
    begin
      MsgBox('{cm:UninstallService}', mbInformation, MB_OK);
      StopAndDeleteService('{#ServiceName}');
    end;
  end;
end;

// ── dynamic dir-page label ───────────────────────────────────────────────────
// Show a hint in the dir page when portable mode is selected.

procedure InitializeWizard();
begin
  // Nothing extra needed; all logic handled by Tasks + Code above.
end;
