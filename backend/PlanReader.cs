/// <summary>기획서.md 에서 Program.cs 파싱 규칙(`- ` 접두사) 항목을 읽습니다.</summary>
static class PlanReader
{
    public static IReadOnlyList<string> ReadItems(string planFilePath)
    {
        if (!File.Exists(planFilePath))
            return Array.Empty<string>();

        var items = new List<string>();
        foreach (var line in File.ReadAllLines(planFilePath))
        {
            if (line.StartsWith("- "))
                items.Add(line.Replace("- ", "").Trim());
        }
        return items;
    }
}
