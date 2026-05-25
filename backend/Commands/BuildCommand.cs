/// <summary>Vite 프로덕션 빌드 및 Cesium 자산 검증</summary>
static class BuildCommand
{
    static readonly string[] RequiredDistFiles =
    [
        "index.html",
        "cesium.html",
    ];

    public static int Execute(string[] args)
    {
        Console.WriteLine("[엔진] build — Vite 프로덕션 빌드");

        var projectDir = EnginePaths.GeneratedProject;
        if (!Directory.Exists(projectDir))
        {
            Console.Error.WriteLine($"[오류] 생성 프로젝트 없음: {projectDir}");
            Console.Error.WriteLine("       `dotnet run -- sync` 를 실행하세요.");
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
            Console.WriteLine("[엔진] node_modules 없음 — npm install");
            if (NpmRunner.Run(projectDir, "install") != 0)
            {
                Console.Error.WriteLine("[오류] npm install 실패");
                return 1;
            }
        }

        Console.WriteLine("[엔진] npm run build 실행 중…");
        if (NpmRunner.Run(projectDir, "run build") != 0)
        {
            Console.Error.WriteLine("[오류] Vite 빌드 실패");
            Console.Error.WriteLine("       `dotnet run -- doctor` 로 환경을 점검하세요.");
            return 1;
        }

        var distDir = Path.Combine(projectDir, "dist");
        if (!Directory.Exists(distDir))
        {
            Console.Error.WriteLine("[오류] dist/ 폴더가 생성되지 않았습니다.");
            return 1;
        }

        int missing = 0;
        foreach (var rel in RequiredDistFiles)
        {
            var full = Path.Combine(distDir, rel.Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(full))
                Console.WriteLine($"[OK]   dist/{rel}");
            else
            {
                Console.WriteLine($"[FAIL] dist/{rel} 없음");
                missing++;
            }
        }

        var distCesium = Path.Combine(distDir, "cesium");
        var (_, cesiumFail) = CesiumAssetChecks.Verify(distCesium, "dist/cesium");
        missing += cesiumFail;

        if (missing > 0)
        {
            Console.Error.WriteLine($"[오류] 빌드 산출물 {missing}개 누락 — Cesium static-copy 확인");
            return 1;
        }

        Console.WriteLine();
        Console.WriteLine($"[엔진] build 완료 — {distDir}");
        Console.WriteLine("  미리보기: cd frontend && npm run preview");
        return 0;
    }
}
