using System.Diagnostics;

/// <summary>MyWaveCompany_Generated Vite 개발 서버 실행</summary>
static class ServeCommand
{
    public static int Execute(string[] args)
    {
        Console.WriteLine("[엔진] serve — Vite 개발 서버 시작");

        var projectDir = EnginePaths.GeneratedProject;
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
            Console.WriteLine("[엔진] node_modules 없음 — npm install 실행");
            if (RunNpm(projectDir, "install") != 0)
                return 1;
        }

        var npmArgs = "run dev";
        if (args.Contains("--cesium"))
            Console.WriteLine("[엔진] Cesium 데모: http://localhost:5173/cesium.html");

        Console.WriteLine($"[엔진] Three.js 데모: http://localhost:5173/");
        Console.WriteLine("[엔진] 종료: Ctrl+C");

        return RunNpm(projectDir, npmArgs, interactive: true);
    }

    static int RunNpm(string workingDirectory, string arguments, bool interactive = false)
    {
        try
        {
            using var process = new Process { StartInfo = CreateNpmStartInfo(workingDirectory, arguments, interactive) };
            process.Start();

            if (interactive)
            {
                process.WaitForExit();
                return process.ExitCode;
            }

            var output = process.StandardOutput.ReadToEnd();
            var error = process.StandardError.ReadToEnd();
            process.WaitForExit();

            if (!string.IsNullOrWhiteSpace(output))
                Console.Write(output);
            if (!string.IsNullOrWhiteSpace(error))
                Console.Error.Write(error);

            return process.ExitCode;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[오류] npm 실행 실패: {ex.Message}");
            Console.Error.WriteLine("       Node.js / npm 이 PATH에 설치되어 있는지 확인하세요.");
            return 1;
        }
    }

    static ProcessStartInfo CreateNpmStartInfo(string workingDirectory, string arguments, bool interactive)
    {
        if (OperatingSystem.IsWindows())
        {
            return new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c npm {arguments}",
                WorkingDirectory = workingDirectory,
                UseShellExecute = false,
                RedirectStandardOutput = !interactive,
                RedirectStandardError = !interactive,
            };
        }

        return new ProcessStartInfo
        {
            FileName = "npm",
            Arguments = arguments,
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = !interactive,
            RedirectStandardError = !interactive,
        };
    }
}
