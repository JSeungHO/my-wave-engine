using System.Diagnostics;

/// <summary>frontend/ 에서 npm 명령 실행</summary>
static class NpmRunner
{
    public static int Run(string workingDirectory, string arguments, bool interactive = false)
    {
        try
        {
            using var process = new Process { StartInfo = CreateStartInfo(workingDirectory, arguments, interactive) };
            process.Start();

            if (interactive)
            {
                process.WaitForExit();
                return process.ExitCode;
            }

            var output = process.StandardOutput.ReadToEnd();
            var error = process.StandardError.ReadToEnd();
            process.WaitForExit();

            if (!string.IsNullOrWhiteSpace(output)) Console.Write(output);
            if (!string.IsNullOrWhiteSpace(error)) Console.Error.Write(error);

            return process.ExitCode;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[오류] npm 실행 실패: {ex.Message}");
            Console.Error.WriteLine("       Node.js / npm 이 PATH 에 등록되어 있는지 확인하세요.");
            return 1;
        }
    }

    public static bool TryGetNodeVersion(out string? version)
    {
        version = null;
        try
        {
            using var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = OperatingSystem.IsWindows() ? "cmd.exe" : "node",
                    Arguments = OperatingSystem.IsWindows() ? "/c node --version" : "--version",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                },
            };
            process.Start();
            version = process.StandardOutput.ReadToEnd().Trim();
            process.WaitForExit();
            return process.ExitCode == 0 && !string.IsNullOrWhiteSpace(version);
        }
        catch
        {
            return false;
        }
    }

    public static bool TryGetNpmVersion(out string? version)
    {
        version = null;
        try
        {
            using var process = new Process
            {
                StartInfo = CreateStartInfo(Directory.GetCurrentDirectory(), "--version", interactive: false),
            };
            process.Start();
            version = process.StandardOutput.ReadToEnd().Trim();
            process.WaitForExit();
            return process.ExitCode == 0 && !string.IsNullOrWhiteSpace(version);
        }
        catch
        {
            return false;
        }
    }

    static ProcessStartInfo CreateStartInfo(string workingDirectory, string arguments, bool interactive)
    {
        var isWindows = OperatingSystem.IsWindows();
        return new ProcessStartInfo
        {
            FileName = isWindows ? "cmd.exe" : "npm",
            Arguments = isWindows ? $"/c npm {arguments}" : arguments,
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = !interactive,
            RedirectStandardError = !interactive,
        };
    }
}
