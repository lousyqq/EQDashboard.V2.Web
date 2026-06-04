USE [EQDashboardV2]
GO

/****** Object:  Table [dbo].[UserActivityLogs]    Script Date: 2026/6/4 下午 10:45:32 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[UserActivityLogs](
	[LogId] [bigint] IDENTITY(1,1) NOT NULL,
	[Timestamp] [datetime2](7) NOT NULL,
	[EmpId] [nvarchar](50) NULL,
	[EmpName] [nvarchar](100) NULL,
	[LoginSource] [nvarchar](20) NULL,
	[IpAddress] [nvarchar](45) NULL,
	[UserAgent] [nvarchar](500) NULL,
	[HttpMethod] [nvarchar](10) NULL,
	[Path] [nvarchar](500) NULL,
	[QueryString] [nvarchar](500) NULL,
	[StatusCode] [int] NULL,
	[DurationMs] [int] NULL,
	[Category] [nvarchar](50) NULL,
	[Action] [nvarchar](100) NULL,
	[TargetType] [nvarchar](50) NULL,
	[TargetId] [nvarchar](100) NULL,
	[Detail] [nvarchar](max) NULL,
	[IsSuccess] [bit] NULL,
	[ErrorMessage] [nvarchar](500) NULL,
PRIMARY KEY CLUSTERED 
(
	[LogId] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO


