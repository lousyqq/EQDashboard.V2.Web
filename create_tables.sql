CREATE TABLE [Accounts] (
    [EmpId] nvarchar(50) NOT NULL,
    [Name] nvarchar(max) NULL,
    [Department] nvarchar(max) NULL,
    [RoleLevel] nvarchar(max) NULL,
    [CanEditOthers] bit NULL,
    [LoginCount] int NULL,
    [LastLoginTime] datetime2 NULL,
    CONSTRAINT [PK_Accounts] PRIMARY KEY ([EmpId])
);
GO


CREATE TABLE [Apps] (
    [AppId] nvarchar(50) NOT NULL,
    [MenuId] nvarchar(max) NULL,
    [AppName] nvarchar(max) NULL,
    [Url] nvarchar(max) NULL,
    [IconBase64] nvarchar(max) NULL,
    [Target] nvarchar(max) NULL,
    CONSTRAINT [PK_Apps] PRIMARY KEY ([AppId])
);
GO


CREATE TABLE [Fabs] (
    [FabId] nvarchar(50) NOT NULL,
    [FabName] nvarchar(max) NULL,
    [DisplayName] nvarchar(max) NULL,
    [DefaultLang] nvarchar(max) NULL,
    CONSTRAINT [PK_Fabs] PRIMARY KEY ([FabId])
);
GO


CREATE TABLE [Menus] (
    [MenuId] nvarchar(50) NOT NULL,
    [SysName] nvarchar(max) NULL,
    [DisplayName] nvarchar(max) NULL,
    [MenuMode] nvarchar(max) NULL,
    [Url] nvarchar(max) NULL,
    [TargetPage] nvarchar(max) NULL,
    [OpenTarget] nvarchar(max) NULL,
    [Icon] nvarchar(max) NULL,
    [CreatedBy] nvarchar(max) NULL,
    [IsEnabled] bit NULL,
    [IsPoolItem] bit NULL,
    [IsEdited] bit NULL,
    [GlobalOrder] int NULL,
    CONSTRAINT [PK_Menus] PRIMARY KEY ([MenuId])
);
GO


CREATE TABLE [PersonalSettings] (
    [EmpId] nvarchar(50) NOT NULL,
    [MenuId] nvarchar(50) NOT NULL,
    [IsHidden] bit NULL,
    [OpenTarget] nvarchar(max) NULL,
    [Icon] nvarchar(max) NULL,
    [SortOrder] int NULL,
    CONSTRAINT [PK_PersonalSettings] PRIMARY KEY ([EmpId], [MenuId])
);
GO


CREATE TABLE [Requests] (
    [RequestId] nvarchar(50) NOT NULL,
    [EmpId] nvarchar(max) NULL,
    [EmpName] nvarchar(max) NULL,
    [Reason] nvarchar(max) NULL,
    [Timestamp] bigint NULL,
    [Status] nvarchar(max) NULL,
    [WithdrawReason] nvarchar(max) NULL,
    [Reply] nvarchar(max) NULL,
    [ReqType] nvarchar(max) NULL,
    [Fab] nvarchar(max) NULL,
    CONSTRAINT [PK_Requests] PRIMARY KEY ([RequestId])
);
GO


CREATE TABLE [Roles] (
    [RoleId] nvarchar(50) NOT NULL,
    [GroupName] nvarchar(max) NULL,
    CONSTRAINT [PK_Roles] PRIMARY KEY ([RoleId])
);
GO


CREATE TABLE [UserActivityLogs] (
    [LogId] bigint NOT NULL IDENTITY,
    [Timestamp] datetime2 NOT NULL,
    [EmpId] nvarchar(50) NULL,
    [EmpName] nvarchar(100) NULL,
    [LoginSource] nvarchar(20) NULL,
    [IpAddress] nvarchar(45) NULL,
    [UserAgent] nvarchar(500) NULL,
    [HttpMethod] nvarchar(10) NULL,
    [Path] nvarchar(500) NULL,
    [QueryString] nvarchar(500) NULL,
    [StatusCode] int NULL,
    [DurationMs] int NULL,
    [Category] nvarchar(50) NULL,
    [Action] nvarchar(100) NULL,
    [TargetType] nvarchar(50) NULL,
    [TargetId] nvarchar(100) NULL,
    [Detail] nvarchar(max) NULL,
    [IsSuccess] bit NULL,
    [ErrorMessage] nvarchar(500) NULL,
    CONSTRAINT [PK_UserActivityLogs] PRIMARY KEY ([LogId])
);
GO


CREATE TABLE [Map_Account_DefaultPage] (
    [EmpId] nvarchar(50) NOT NULL,
    [FabId] nvarchar(50) NOT NULL,
    [MenuId] nvarchar(50) NOT NULL,
    CONSTRAINT [PK_Map_Account_DefaultPage] PRIMARY KEY ([EmpId], [FabId], [MenuId]),
    CONSTRAINT [FK_Map_Account_DefaultPage_Accounts_EmpId] FOREIGN KEY ([EmpId]) REFERENCES [Accounts] ([EmpId]) ON DELETE CASCADE,
    CONSTRAINT [FK_Map_Account_DefaultPage_Fabs_FabId] FOREIGN KEY ([FabId]) REFERENCES [Fabs] ([FabId]) ON DELETE CASCADE,
    CONSTRAINT [FK_Map_Account_DefaultPage_Menus_MenuId] FOREIGN KEY ([MenuId]) REFERENCES [Menus] ([MenuId]) ON DELETE CASCADE
);
GO


CREATE TABLE [Map_Account_DenyMenu] (
    [EmpId] nvarchar(50) NOT NULL,
    [MenuId] nvarchar(50) NOT NULL,
    CONSTRAINT [PK_Map_Account_DenyMenu] PRIMARY KEY ([EmpId], [MenuId]),
    CONSTRAINT [FK_Map_Account_DenyMenu_Accounts_EmpId] FOREIGN KEY ([EmpId]) REFERENCES [Accounts] ([EmpId]) ON DELETE CASCADE,
    CONSTRAINT [FK_Map_Account_DenyMenu_Menus_MenuId] FOREIGN KEY ([MenuId]) REFERENCES [Menus] ([MenuId]) ON DELETE CASCADE
);
GO


CREATE TABLE [Map_Account_ExtraMenu] (
    [EmpId] nvarchar(50) NOT NULL,
    [MenuId] nvarchar(50) NOT NULL,
    CONSTRAINT [PK_Map_Account_ExtraMenu] PRIMARY KEY ([EmpId], [MenuId]),
    CONSTRAINT [FK_Map_Account_ExtraMenu_Accounts_EmpId] FOREIGN KEY ([EmpId]) REFERENCES [Accounts] ([EmpId]) ON DELETE CASCADE,
    CONSTRAINT [FK_Map_Account_ExtraMenu_Menus_MenuId] FOREIGN KEY ([MenuId]) REFERENCES [Menus] ([MenuId]) ON DELETE CASCADE
);
GO


CREATE TABLE [Map_Account_ManageMenu] (
    [EmpId] nvarchar(50) NOT NULL,
    [MenuId] nvarchar(50) NOT NULL,
    CONSTRAINT [PK_Map_Account_ManageMenu] PRIMARY KEY ([EmpId], [MenuId]),
    CONSTRAINT [FK_Map_Account_ManageMenu_Accounts_EmpId] FOREIGN KEY ([EmpId]) REFERENCES [Accounts] ([EmpId]) ON DELETE CASCADE,
    CONSTRAINT [FK_Map_Account_ManageMenu_Menus_MenuId] FOREIGN KEY ([MenuId]) REFERENCES [Menus] ([MenuId]) ON DELETE CASCADE
);
GO


CREATE TABLE [Map_Menu_AllowAccount] (
    [MenuId] nvarchar(50) NOT NULL,
    [EmpId] nvarchar(50) NOT NULL,
    CONSTRAINT [PK_Map_Menu_AllowAccount] PRIMARY KEY ([MenuId], [EmpId]),
    CONSTRAINT [FK_Map_Menu_AllowAccount_Accounts_EmpId] FOREIGN KEY ([EmpId]) REFERENCES [Accounts] ([EmpId]) ON DELETE CASCADE,
    CONSTRAINT [FK_Map_Menu_AllowAccount_Menus_MenuId] FOREIGN KEY ([MenuId]) REFERENCES [Menus] ([MenuId]) ON DELETE CASCADE
);
GO


CREATE TABLE [Map_Menu_DenyAccount] (
    [MenuId] nvarchar(50) NOT NULL,
    [EmpId] nvarchar(50) NOT NULL,
    CONSTRAINT [PK_Map_Menu_DenyAccount] PRIMARY KEY ([MenuId], [EmpId]),
    CONSTRAINT [FK_Map_Menu_DenyAccount_Accounts_EmpId] FOREIGN KEY ([EmpId]) REFERENCES [Accounts] ([EmpId]) ON DELETE CASCADE,
    CONSTRAINT [FK_Map_Menu_DenyAccount_Menus_MenuId] FOREIGN KEY ([MenuId]) REFERENCES [Menus] ([MenuId]) ON DELETE CASCADE
);
GO


CREATE TABLE [Map_Menu_Structure] (
    [ParentMenuId] nvarchar(50) NOT NULL,
    [ChildMenuId] nvarchar(50) NOT NULL,
    [SortOrder] int NULL,
    CONSTRAINT [PK_Map_Menu_Structure] PRIMARY KEY ([ParentMenuId], [ChildMenuId]),
    CONSTRAINT [FK_Map_Menu_Structure_Menus_ChildMenuId] FOREIGN KEY ([ChildMenuId]) REFERENCES [Menus] ([MenuId]) ON DELETE NO ACTION,
    CONSTRAINT [FK_Map_Menu_Structure_Menus_ParentMenuId] FOREIGN KEY ([ParentMenuId]) REFERENCES [Menus] ([MenuId]) ON DELETE NO ACTION
);
GO


CREATE TABLE [Map_Account_Role] (
    [EmpId] nvarchar(50) NOT NULL,
    [RoleId] nvarchar(50) NOT NULL,
    CONSTRAINT [PK_Map_Account_Role] PRIMARY KEY ([EmpId], [RoleId]),
    CONSTRAINT [FK_Map_Account_Role_Accounts_EmpId] FOREIGN KEY ([EmpId]) REFERENCES [Accounts] ([EmpId]) ON DELETE CASCADE,
    CONSTRAINT [FK_Map_Account_Role_Roles_RoleId] FOREIGN KEY ([RoleId]) REFERENCES [Roles] ([RoleId]) ON DELETE CASCADE
);
GO


CREATE TABLE [Map_Fab_Role] (
    [FabId] nvarchar(50) NOT NULL,
    [RoleId] nvarchar(50) NOT NULL,
    CONSTRAINT [PK_Map_Fab_Role] PRIMARY KEY ([FabId], [RoleId]),
    CONSTRAINT [FK_Map_Fab_Role_Fabs_FabId] FOREIGN KEY ([FabId]) REFERENCES [Fabs] ([FabId]) ON DELETE CASCADE,
    CONSTRAINT [FK_Map_Fab_Role_Roles_RoleId] FOREIGN KEY ([RoleId]) REFERENCES [Roles] ([RoleId]) ON DELETE CASCADE
);
GO


CREATE TABLE [Map_Role_Menu] (
    [RoleId] nvarchar(50) NOT NULL,
    [MenuId] nvarchar(50) NOT NULL,
    [SortOrder] int NULL,
    CONSTRAINT [PK_Map_Role_Menu] PRIMARY KEY ([RoleId], [MenuId]),
    CONSTRAINT [FK_Map_Role_Menu_Menus_MenuId] FOREIGN KEY ([MenuId]) REFERENCES [Menus] ([MenuId]) ON DELETE CASCADE,
    CONSTRAINT [FK_Map_Role_Menu_Roles_RoleId] FOREIGN KEY ([RoleId]) REFERENCES [Roles] ([RoleId]) ON DELETE CASCADE
);
GO


CREATE INDEX [IX_Map_Account_DefaultPage_FabId] ON [Map_Account_DefaultPage] ([FabId]);
GO


CREATE INDEX [IX_Map_Account_DefaultPage_MenuId] ON [Map_Account_DefaultPage] ([MenuId]);
GO


CREATE INDEX [IX_Map_Account_DenyMenu_MenuId] ON [Map_Account_DenyMenu] ([MenuId]);
GO


CREATE INDEX [IX_Map_Account_ExtraMenu_MenuId] ON [Map_Account_ExtraMenu] ([MenuId]);
GO


CREATE INDEX [IX_Map_Account_ManageMenu_MenuId] ON [Map_Account_ManageMenu] ([MenuId]);
GO


CREATE INDEX [IX_Map_Account_Role_RoleId] ON [Map_Account_Role] ([RoleId]);
GO


CREATE INDEX [IX_Map_Fab_Role_RoleId] ON [Map_Fab_Role] ([RoleId]);
GO


CREATE INDEX [IX_Map_Menu_AllowAccount_EmpId] ON [Map_Menu_AllowAccount] ([EmpId]);
GO


CREATE INDEX [IX_Map_Menu_DenyAccount_EmpId] ON [Map_Menu_DenyAccount] ([EmpId]);
GO


CREATE INDEX [IX_Map_Menu_Structure_ChildMenuId] ON [Map_Menu_Structure] ([ChildMenuId]);
GO


CREATE INDEX [IX_Map_Role_Menu_MenuId] ON [Map_Role_Menu] ([MenuId]);
GO


