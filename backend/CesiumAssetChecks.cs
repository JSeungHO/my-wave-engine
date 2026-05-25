/// <summary>Cesium 정적 자산(Workers·Assets 등) 존재 검증</summary>
static class CesiumAssetChecks
{
    static readonly string[] FileProbes =
    [
        "Assets/approximateTerrainHeights.json",
        "ThirdParty/basis_transcoder.wasm",
        "Widgets/widgets.css",
    ];

    /// <summary>node_modules 또는 dist/cesium 루트 기준 검증</summary>
    public static (int pass, int fail) Verify(string cesiumRoot, string label)
    {
        int pass = 0, fail = 0;

        if (!Directory.Exists(cesiumRoot))
        {
            Console.WriteLine($"[FAIL] {label} — 경로 없음: {cesiumRoot}");
            return (0, 1);
        }

        var workersDir = Path.Combine(cesiumRoot, "Workers");
        var workerCount = Directory.Exists(workersDir)
            ? Directory.EnumerateFiles(workersDir, "*.js").Count()
            : 0;

        if (workerCount > 0)
        {
            Console.WriteLine($"[OK]   {label} — Workers/*.js ({workerCount}개)");
            pass++;
        }
        else
        {
            Console.WriteLine($"[FAIL] {label} — Workers/*.js 없음 (Cesium 404 원인)");
            fail++;
        }

        foreach (var rel in FileProbes)
        {
            var full = Path.Combine(cesiumRoot, rel.Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(full))
            {
                Console.WriteLine($"[OK]   {label} — {rel}");
                pass++;
            }
            else
            {
                Console.WriteLine($"[FAIL] {label} — {rel} 없음");
                fail++;
            }
        }

        return (pass, fail);
    }
}
