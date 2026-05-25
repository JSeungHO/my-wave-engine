using System.Text.RegularExpressions;

/// <summary>MyAutomationEngine 루트 .env 파싱</summary>
static partial class EnvReader
{
    public static string? GetValue(string key, string? envFilePath = null)
    {
        envFilePath ??= Path.Combine(EnginePaths.Root, ".env");
        if (!File.Exists(envFilePath))
            return null;

        foreach (var line in File.ReadAllLines(envFilePath))
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0 || trimmed.StartsWith('#'))
                continue;

            var match = EnvLineRegex().Match(trimmed);
            if (!match.Success)
                continue;

            if (!string.Equals(match.Groups["key"].Value.Trim(), key, StringComparison.Ordinal))
                continue;

            var raw = match.Groups["value"].Value.Trim();
            if (raw.Length >= 2 &&
                ((raw.StartsWith('"') && raw.EndsWith('"')) ||
                 (raw.StartsWith('\'') && raw.EndsWith('\''))))
            {
                raw = raw[1..^1];
            }

            return raw;
        }

        return null;
    }

    [GeneratedRegex(@"^(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?<value>.*)$")]
    private static partial Regex EnvLineRegex();
}
