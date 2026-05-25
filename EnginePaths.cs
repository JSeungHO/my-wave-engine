/// <summary>자동화 엔진 경로 상수</summary>
static class EnginePaths
{
    public static string Root { get; } = Directory.GetCurrentDirectory();

    public static string GeneratedProject => Path.Combine(Root, "MyWaveCompany_Generated");
    public static string PlanFile => Path.Combine(Root, "기획서.md");
    public static string TemplatesDir => Path.Combine(Root, "Templates");
    public static string TemplateTargetDir => Path.Combine(GeneratedProject, "src", "adapters", "cesium");
}
