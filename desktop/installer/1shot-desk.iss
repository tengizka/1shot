; 1SHOT Desk installer (Inno Setup 6). Build: ISCC /DAppVersion=3.0.0 desktop\installer\1shot-desk.iss
; Per-user install: no admin rights are needed, and Desk can update itself in place.
; Local data (.env, desk.sqlite3, sounds) lives in %LOCALAPPDATA%\1SHOT Desk and is never removed.
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define AppName "1SHOT Desk"
#define AppExe "1SHOT-Desk.exe"

[Setup]
AppId={{6E3B1F2A-1D7C-4B8E-9A51-3C1D5E7F9A01}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=tengizka
AppPublisherURL=https://github.com/tengizka/1shot
AppSupportURL=https://github.com/tengizka/1shot/releases
VersionInfoVersion={#AppVersion}
VersionInfoDescription=1SHOT Club Desk installer
DefaultDirName={localappdata}\Programs\1SHOT Desk
DefaultGroupName=1SHOT
DisableProgramGroupPage=yes
DisableDirPage=auto
DisableReadyPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\dist
OutputBaseFilename=1SHOT-Desk-Setup
SetupIconFile=..\assets\app.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
WizardStyle=modern
WizardSizePercent=110
WizardImageFile=wizard.bmp,wizard-200.bmp
WizardSmallImageFile=small.bmp,small-200.bmp
Compression=lzma2/max
SolidCompression=yes
CloseApplications=force
CloseApplicationsFilter={#AppExe}
RestartApplications=no
SetupMutex=1SHOTDeskSetup

[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"

[Messages]
ru.WelcomeLabel1=1SHOT Desk
ru.WelcomeLabel2=Панель администратора клуба: карта зала, брони, аккаунты и уведомления.%n%nНастройки и журнал броней сохранятся при обновлении.
ru.FinishedHeadingLabel=1SHOT Desk установлен

[Tasks]
Name: "desktopicon"; Description: "Ярлык на рабочем столе"; GroupDescription: "Ярлыки:"
Name: "autostart"; Description: "Запускать вместе с Windows"; GroupDescription: "Запуск:"; Flags: unchecked

[InstallDelete]
; Old libraries from previous versions must not linger next to the new build.
Type: filesandordirs; Name: "{app}\_internal"

[Files]
Source: "..\..\dist\1SHOT-Desk\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; First install only: a template for the club settings, never overwritten.
Source: "..\env.example"; DestDir: "{localappdata}\1SHOT Desk"; DestName: ".env"; Flags: onlyifdoesntexist uninsneveruninstall

[Icons]
Name: "{userprograms}\1SHOT Desk"; Filename: "{app}\{#AppExe}"
Name: "{userdesktop}\1SHOT Desk"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon
Name: "{userstartup}\1SHOT Desk"; Filename: "{app}\{#AppExe}"; Tasks: autostart

[Run]
; Runs after a manual install (checkbox) and after a silent self-update.
Filename: "{app}\{#AppExe}"; Description: "Запустить 1SHOT Desk"; Flags: nowait postinstall
