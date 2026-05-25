/// <summary>Cesium 404·토큰·빌드 환경 자가 진단</summary>
static class DoctorCommand
{
    public static int Execute(string[] args)
    {
        Console.WriteLine("[엔진] doctor — 개발 환경 자가 진단");
        Console.WriteLine();

        int pass = 0, warn = 0, fail = 0;

        void Ok(string msg)   { Console.WriteLine($"[OK]   {msg}"); pass++; }
        void Warn(string msg) { Console.WriteLine($"[WARN] {msg}"); warn++; }
        void Fail(string msg) { Console.WriteLine($"[FAIL] {msg}"); fail++; }

        // ── Node / npm ──────────────────────────────────────────────────────
        Console.WriteLine("── 런타임 ──");
        if (NpmRunner.TryGetNodeVersion(out var nodeVer))
            Ok($"Node.js {nodeVer}");
        else
            Fail("Node.js 없음 — https://nodejs.org 설치 후 PATH 등록");

        if (NpmRunner.TryGetNpmVersion(out var npmVer))
            Ok($"npm {npmVer}");
        else
            Fail("npm 없음");

        // ── 프로젝트 골격 ───────────────────────────────────────────────────
        Console.WriteLine();
        Console.WriteLine("── 프로젝트 ──");
        if (File.Exists(EnginePaths.PlanFile))
            Ok($"기획서: {EnginePaths.PlanFile}");
        else
            Fail($"기획서 없음: {EnginePaths.PlanFile}");

        var projectDir = EnginePaths.GeneratedProject;
        if (Directory.Exists(projectDir))
            Ok($"생성 프로젝트: {projectDir}");
        else
        {
            Fail($"생성 프로젝트 없음 — `dotnet run -- sync` 실행");
            PrintSummary(pass, warn, fail);
            return 1;
        }

        var packageJson = Path.Combine(projectDir, "package.json");
        if (File.Exists(packageJson))
            Ok("package.json");
        else
            Fail("package.json 없음");

        // ── Ion 토큰 ────────────────────────────────────────────────────────
        Console.WriteLine();
        Console.WriteLine("── Cesium Ion ──");
        var envPath = Path.Combine(EnginePaths.Root, ".env");
        if (File.Exists(envPath))
            Ok($".env 존재: {envPath}");
        else
            Warn($".env 없음 — {envPath} (Ion 지형/Imagery 제한)");

        var token = EnvReader.GetValue("CESIUM_ION_TOKEN")
                 ?? EnvReader.GetValue("VITE_CESIUM_ION_TOKEN");
        if (string.IsNullOrWhiteSpace(token))
            Warn("CESIUM_ION_TOKEN 미설정 — .env 에 CESIUM_ION_TOKEN=... 추가");
        else if (token is "YOUR_CESIUM_ION_TOKEN" or "your_token_here")
            Warn("CESIUM_ION_TOKEN 이 placeholder — https://ion.cesium.com/tokens");
        else
            Ok($"CESIUM_ION_TOKEN 설정됨 ({token[..Math.Min(8, token.Length)]}…)");

        // ── npm 의존성 ────────────────────────────────────────────────────────
        Console.WriteLine();
        Console.WriteLine("── npm 의존성 ──");
        var nodeModules = Path.Combine(projectDir, "node_modules");
        if (Directory.Exists(nodeModules))
            Ok("node_modules");
        else
            Warn("node_modules 없음 — `dotnet run -- serve` 또는 `dotnet run -- build` 시 자동 설치");

        var pluginutils = Path.Combine(nodeModules, "@rollup", "pluginutils");
        var esbuildPkg  = Path.Combine(nodeModules, "esbuild");
        if (Directory.Exists(pluginutils) && Directory.Exists(esbuildPkg))
            Ok("vite-plugin-glsl peer deps (@rollup/pluginutils, esbuild)");
        else
            Fail("vite-plugin-glsl peer deps 누락 — JS가 문자열로 변환되어 '로딩 중'에서 멈춤 (npm install -D @rollup/pluginutils esbuild)");

        var cesiumPkg = Path.Combine(nodeModules, "cesium", "Build", "Cesium");
        if (Directory.Exists(cesiumPkg))
            Ok("node_modules/cesium/Build/Cesium");
        else
            Fail("cesium 패키지 없음 — npm install 필요");

        var (cesiumPass, cesiumFail) = CesiumAssetChecks.Verify(cesiumPkg, "node_modules/cesium");
        pass += cesiumPass;
        fail += cesiumFail;

        // ── Vite / HTML 설정 ────────────────────────────────────────────────
        Console.WriteLine();
        Console.WriteLine("── Vite / Cesium 경로 ──");
        var viteConfig = Path.Combine(projectDir, "vite.config.js");
        if (File.Exists(viteConfig))
        {
            var viteText = File.ReadAllText(viteConfig);
            if (viteText.Contains("vite-plugin-static-copy", StringComparison.Ordinal))
                Ok("vite.config.js — vite-plugin-static-copy");
            else
                Fail("vite.config.js — vite-plugin-static-copy 미사용 (Cesium 404 원인)");

            if (viteText.Contains("CESIUM_BASE_URL", StringComparison.Ordinal))
                Ok("vite.config.js — CESIUM_BASE_URL define");
            else
                Warn("vite.config.js — CESIUM_BASE_URL define 없음");
        }
        else
        {
            Fail("vite.config.js 없음");
        }

        foreach (var htmlName in new[] { "index.html", "cesium.html" })
        {
            var htmlPath = Path.Combine(projectDir, htmlName);
            if (!File.Exists(htmlPath))
            {
                Fail($"{htmlName} 없음");
                continue;
            }

            var html = File.ReadAllText(htmlPath);
            if (html.Contains("CESIUM_BASE_URL", StringComparison.Ordinal) &&
                html.Contains("/cesium/", StringComparison.Ordinal))
                Ok($"{htmlName} — CESIUM_BASE_URL=/cesium/");
            else
                Fail($"{htmlName} — CESIUM_BASE_URL 스크립트 누락 (Workers 404 원인)");
        }

        var entryJs = Path.Combine(projectDir, "src", "adapters", "cesium", "cesium-main.js");
        if (File.Exists(entryJs))
            Ok("진입점: src/adapters/cesium/cesium-main.js");
        else
            Fail("진입점 없음: src/adapters/cesium/cesium-main.js");

        // ── 배포/캐시 산출물 ──────────────────────────────────────────────────
        Console.WriteLine();
        Console.WriteLine("── 빌드 산출물 (선택) ──");
        var distCesium = Path.Combine(projectDir, "dist", "cesium");
        if (Directory.Exists(distCesium))
        {
            var (distPass, distFail) = CesiumAssetChecks.Verify(distCesium, "dist/cesium");
            pass += distPass;
            if (distFail > 0)
                fail += distFail;
            else
                Ok("dist/cesium — build 산출물 정상");
        }
        else
        {
            Warn("dist/cesium 없음 — 아직 build 안 함 (`dotnet run -- build`)");
        }

        var publicCesium = Path.Combine(projectDir, "public", "cesium");
        if (Directory.Exists(publicCesium))
            Ok("public/cesium (레거시 캐시 — dev 에서 static-copy 가 우선)");
        else
            Ok("public/cesium 없음 (정상 — vite-plugin-static-copy 가 dev/build 제공)");

        Console.WriteLine();
        PrintSummary(pass, warn, fail);

        if (fail > 0)
        {
            Console.WriteLine();
            Console.WriteLine("조치 제안:");
            Console.WriteLine("  dotnet run -- clean          # node_modules·dist 초기화");
            Console.WriteLine("  dotnet run -- sync           # 기획서 동기화");
            Console.WriteLine("  dotnet run -- build          # Vite 빌드 + dist/cesium 확인");
            Console.WriteLine("  dotnet run -- serve          # 브라우저 F12 → Network → /cesium/ 404 확인");
            return 1;
        }

        if (warn > 0)
            Console.WriteLine("[엔진] 경고는 있으나 실행 가능합니다.");

        return 0;
    }

    static void PrintSummary(int pass, int warn, int fail)
    {
        Console.WriteLine($"[엔진] doctor 완료 — OK {pass}, WARN {warn}, FAIL {fail}");
    }
}
