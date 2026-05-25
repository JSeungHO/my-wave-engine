/// <summary>자동화 엔진 경로 상수</summary>
static class EnginePaths
{
    /// <summary>저장소 루트 (frontend/, docs/, 기획서.md)</summary>
    public static string Root { get; } = FindRepoRoot();

    /// <summary>Vite + Cesium WebGL 프로젝트</summary>
    public static string FrontendProject => Path.Combine(Root, "frontend");

    /// <summary>@deprecated FrontendProject 사용</summary>
    public static string GeneratedProject => FrontendProject;

    public static string PlanFile => Path.Combine(Root, "기획서.md");

    public static string TemplatesDir => Path.Combine(Root, "backend", "Templates");

    public static string TemplateTargetDir => Path.Combine(FrontendProject, "src", "adapters", "cesium");

    static string FindRepoRoot()
    {
        var dir = Directory.GetCurrentDirectory();
        if (Directory.Exists(Path.Combine(dir, "frontend")))
            return dir;

        var parent = Path.GetFullPath(Path.Combine(dir, ".."));
        if (Directory.Exists(Path.Combine(parent, "frontend")))
            return parent;

        return dir;
    }
}
