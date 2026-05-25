/// <summary>기획서 + Templates → MyWaveCompany_Generated 동기화</summary>
static class SyncCommand
{
    const string Placeholder = "// TODO: 자동 생성된 코드 파일입니다.";

    public static int Execute()
    {
        Console.WriteLine("[엔진] sync — 프로젝트 스캐폴드 동기화");

        if (!File.Exists(EnginePaths.PlanFile))
        {
            Console.Error.WriteLine($"[오류] 기획서를 찾을 수 없습니다: {EnginePaths.PlanFile}");
            return 1;
        }

        int created = 0, skipped = 0, folders = 0;

        foreach (var item in PlanReader.ReadItems(EnginePaths.PlanFile))
        {
            var fullPath = Path.Combine(EnginePaths.GeneratedProject, item);

            if (item.Contains('.'))
            {
                var dir = Path.GetDirectoryName(fullPath);
                if (!string.IsNullOrEmpty(dir))
                    Directory.CreateDirectory(dir);

                if (File.Exists(fullPath))
                {
                    Console.WriteLine($"[공장] 보호됨: {item} (이미 존재하여 건너뜀)");
                    skipped++;
                }
                else
                {
                    File.WriteAllText(fullPath, Placeholder);
                    Console.WriteLine($"[공장] 파일 생성: {item}");
                    created++;
                }
            }
            else
            {
                Directory.CreateDirectory(fullPath);
                Console.WriteLine($"[공장] 폴더 생성: {item}");
                folders++;
            }
        }

        var templatesCopied = CopyTemplates();

        Console.WriteLine($"[엔진] sync 완료 — 파일 생성 {created}, 보호 {skipped}, 폴더 {folders}, 템플릿 {templatesCopied}");
        return 0;
    }

    static int CopyTemplates()
    {
        if (!Directory.Exists(EnginePaths.TemplatesDir))
        {
            Console.WriteLine("[경고] Templates 폴더가 없습니다. 부품 조립을 건너뜁니다.");
            return 0;
        }

        Directory.CreateDirectory(EnginePaths.TemplateTargetDir);

        int count = 0;
        foreach (var file in Directory.GetFiles(EnginePaths.TemplatesDir))
        {
            var fileName = Path.GetFileName(file);
            var destPath = Path.Combine(EnginePaths.TemplateTargetDir, fileName);
            File.Copy(file, destPath, overwrite: true);
            Console.WriteLine($"[공장] 부품 조립 완료: {fileName}");
            count++;
        }

        return count;
    }
}
