/// <summary>기획서 생성 대상 및 핵심 파일 존재 검증</summary>
static class CheckCommand
{
    static readonly string[] CriticalFiles =
    [
        "core/math/GerstnerWave.js",
        "core/index.js",
        "adapters/cesium/GerstnerWaterPrimitiveGPU.js",
        "adapters/cesium/FloatingEntity.js",
        "adapters/cesium/TangentPlane.js",
        "configs/waves.json",
        "package.json",
        "cesium.html",
    ];

    public static int Execute()
    {
        Console.WriteLine("[엔진] check — 프로젝트 무결성 검증");

        if (!File.Exists(EnginePaths.PlanFile))
        {
            Console.Error.WriteLine($"[FAIL] 기획서 없음: {EnginePaths.PlanFile}");
            return 1;
        }

        if (!Directory.Exists(EnginePaths.GeneratedProject))
        {
            Console.Error.WriteLine($"[FAIL] 생성 프로젝트 없음: {EnginePaths.GeneratedProject}");
            Console.Error.WriteLine("       `dotnet run -- sync` 를 실행하세요.");
            return 1;
        }

        int pass = 0, fail = 0;

        foreach (var item in PlanReader.ReadItems(EnginePaths.PlanFile))
        {
            var fullPath = Path.Combine(EnginePaths.GeneratedProject, item);
            var isFile = item.Contains('.');

            if (isFile)
            {
                if (File.Exists(fullPath))
                {
                    Console.WriteLine($"[OK]   파일: {item}");
                    pass++;
                }
                else
                {
                    Console.WriteLine($"[FAIL] 파일 없음: {item}");
                    fail++;
                }
            }
            else
            {
                if (Directory.Exists(fullPath))
                {
                    Console.WriteLine($"[OK]   폴더: {item}");
                    pass++;
                }
                else
                {
                    Console.WriteLine($"[FAIL] 폴더 없음: {item}");
                    fail++;
                }
            }
        }

        Console.WriteLine("[엔진] — 핵심 구현 파일 (기획서 외) —");

        foreach (var relative in CriticalFiles)
        {
            var fullPath = Path.Combine(EnginePaths.GeneratedProject, relative);
            if (File.Exists(fullPath))
            {
                Console.WriteLine($"[OK]   핵심: {relative}");
                pass++;
            }
            else
            {
                // configs vs Configs 대소문자 차이 허용
                var alt = relative.Replace("configs/", "Configs/", StringComparison.Ordinal);
                var altPath = Path.Combine(EnginePaths.GeneratedProject, alt);
                if (alt != relative && File.Exists(altPath))
                {
                    Console.WriteLine($"[WARN] 경로 대소문자 차이: {relative} → {alt}");
                    pass++;
                }
                else
                {
                    Console.WriteLine($"[FAIL] 핵심 없음: {relative}");
                    fail++;
                }
            }
        }

        Console.WriteLine($"[엔진] check 완료 — OK {pass}, FAIL {fail}");
        return fail > 0 ? 1 : 0;
    }
}
