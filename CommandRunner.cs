/// <summary>프로젝트 실행·관리 CLI 엔진</summary>
static class CommandRunner
{
    public static int Run(string[] args)
    {
        var command = args.Length == 0 ? "sync" : args[0].ToLowerInvariant();
        var rest = args.Length > 1 ? args[1..] : Array.Empty<string>();

        return command switch
        {
            "sync"   => SyncCommand.Execute(),
            "serve"  => ServeCommand.Execute(rest),
            "check"  => CheckCommand.Execute(),
            "doctor" => DoctorCommand.Execute(rest),
            "build"  => BuildCommand.Execute(rest),
            "clean"  => CleanCommand.Execute(rest),
            "help" or "-h" or "--help" => PrintHelp(exitCode: 0),
            _ => PrintHelp(exitCode: 1, unknown: command),
        };
    }

    static int PrintHelp(int exitCode, string? unknown = null)
    {
        if (unknown is not null)
            Console.Error.WriteLine($"[엔진] 알 수 없는 명령: {unknown}");

        Console.WriteLine("""
            MyAutomationEngine — 실행·관리 CLI

            사용법:
              dotnet run -- <command> [options]

            명령:
              sync     기획서.md → MyWaveCompany_Generated/ 동기화 (기본)
              serve    Vite 개발 서버 실행 (npm run dev)
              check    기획서 생성 대상 파일·폴더 존재 검증
              doctor   Cesium 404·Ion 토큰·npm 환경 자가 진단
              build    Vite 프로덕션 빌드 + dist/cesium 검증
              clean    node_modules·dist·public/cesium 삭제
              help     이 도움말 출력

            clean 옵션:
              --full --yes   MyWaveCompany_Generated 전체 삭제 후 sync (파괴적)

            예:
              dotnet run
              dotnet run -- sync
              dotnet run -- serve
              dotnet run -- doctor
              dotnet run -- build
              dotnet run -- clean
              dotnet run -- clean --full --yes
            """);

        return exitCode;
    }
}
