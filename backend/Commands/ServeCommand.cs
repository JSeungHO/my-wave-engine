using System;
using System.IO;
using System.Diagnostics;

/// <summary>frontend/ Vite 개발 서버 실행 및 환경 관리</summary>
static class ServeCommand
{
    public static int Execute(string[] args)
    {
        Console.WriteLine("[엔진] serve — Vite 개발 서버 시작");

        var projectDir = EnginePaths.FrontendProject;
        if (!Directory.Exists(projectDir))
        {
            Console.Error.WriteLine($"[오류] 생성 프로젝트가 없습니다: {projectDir}");
            Console.Error.WriteLine("       먼저 `dotnet run -- sync` 를 실행하세요.");
            return 1;
        }

        var packageJson = Path.Combine(projectDir, "package.json");
        if (!File.Exists(packageJson))
        {
            Console.Error.WriteLine($"[오류] package.json 없음: {packageJson}");
            return 1;
        }

        if (!Directory.Exists(Path.Combine(projectDir, "node_modules")))
        {
            Console.WriteLine("[엔진] node_modules 없음 — 의존성 설치 시작 (npm install)");
            if (NpmRunner.Run(projectDir, "install") != 0)
            {
                Console.Error.WriteLine("[오류] 의존성 설치 실패");
                return 1;
            }
        }

        Console.WriteLine("[엔진] 서버 데모: http://localhost:5173/");
        Console.WriteLine("[엔진] 서버 종료: Ctrl+C");

        return NpmRunner.Run(projectDir, "run dev", interactive: true);
    }
}
