/// <summary>빌드 캐시·의존성·(선택) 생성 프로젝트 전체 초기화</summary>
static class CleanCommand
{
    public static int Execute(string[] args)
    {
        var full = args.Contains("--full", StringComparer.OrdinalIgnoreCase);
        var yes  = args.Contains("--yes", StringComparer.OrdinalIgnoreCase);

        if (full)
        {
            Console.WriteLine("[엔진] clean --full — frontend/ 전체 삭제 후 sync");
            if (!yes)
            {
                Console.Error.WriteLine("[경고] 수동 작성 코드까지 모두 삭제됩니다.");
                Console.Error.WriteLine("       계속: dotnet run -- clean --full --yes");
                return 1;
            }

            return CleanFull();
        }

        Console.WriteLine("[엔진] clean — 빌드 캐시·npm 의존성 초기화");

        var projectDir = EnginePaths.FrontendProject;
        if (!Directory.Exists(projectDir))
        {
            Console.WriteLine("[엔진] 생성 프로젝트 없음 — sync 로 새로 만드세요.");
            return SyncCommand.Execute();
        }

        int removed = 0;
        removed += TryDeleteDirectory(Path.Combine(projectDir, "node_modules"), "node_modules");
        removed += TryDeleteDirectory(Path.Combine(projectDir, "dist"), "dist");
        removed += TryDeleteDirectory(Path.Combine(projectDir, "public", "cesium"), "public/cesium");

        Console.WriteLine($"[엔진] clean 완료 — {removed}개 대상 삭제");
        Console.WriteLine("  다음: dotnet run -- sync && dotnet run -- build");
        return 0;
    }

    static int CleanFull()
    {
        var projectDir = EnginePaths.FrontendProject;
        if (Directory.Exists(projectDir))
        {
            Console.WriteLine($"[엔진] 삭제: {projectDir}");
            try
            {
                Directory.Delete(projectDir, recursive: true);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[오류] 삭제 실패: {ex.Message}");
                Console.Error.WriteLine("       dev 서버·에디터가 파일을 잠그고 있지 않은지 확인하세요.");
                return 1;
            }
        }

        Console.WriteLine("[엔진] sync — 기획서에서 프로젝트 재생성");
        return SyncCommand.Execute();
    }

    static int TryDeleteDirectory(string path, string label)
    {
        if (!Directory.Exists(path))
        {
            Console.WriteLine($"[skip] {label} (없음)");
            return 0;
        }

        try
        {
            Directory.Delete(path, recursive: true);
            Console.WriteLine($"[del]  {label}");
            return 1;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[FAIL] {label} — {ex.Message}");
            return 0;
        }
    }
}
