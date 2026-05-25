using System;
using System.IO;

/// <summary>기획서 + Templates → MyWaveCompany_Generated 동기화</summary>
static class SyncCommand
{
    const string Placeholder = "// TODO: 자동 생성된 코드 파일입니다.";

    public static int Execute()
    {
        Console.WriteLine("[엔진] sync — 프로젝트 스캐폴드 동기화 시작");

        if (!File.Exists(EnginePaths.PlanFile))
        {
            Console.Error.WriteLine($"[오류] 기획서를 찾을 수 없습니다: {EnginePaths.PlanFile}");
            return 1;
        }

        int created = 0, skipped = 0, folders = 0;

        foreach (var item in PlanReader.ReadItems(EnginePaths.PlanFile))
        {
            // 기획서의 항목(item)이 곧 경로(예: Scripts/OceanController.cs)이므로
            // 이를 MyWaveCompany_Generated 경로와 결합합니다.
            var fullPath = Path.Combine(EnginePaths.GeneratedProject, item);

            // 파일인지 폴더인지 구분: 확장자가 있으면 파일, 없으면 폴더로 간주
            if (Path.HasExtension(item)) 
            {
                // 파일이 위치할 디렉토리가 없으면 먼저 생성
                var dir = Path.GetDirectoryName(fullPath);
                if (!string.IsNullOrEmpty(dir))
                    Directory.CreateDirectory(dir);

                if (File.Exists(fullPath))
                {
                    Console.WriteLine($"[공장] 보호됨: {item} (기존 파일 유지)");
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
                // 경로에 확장자가 없으면 폴더로 간주
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

        // 템플릿 타겟 디렉토리가 없으면 생성
        Directory.CreateDirectory(EnginePaths.TemplateTargetDir);

        int count = 0;
        foreach (var file in Directory.GetFiles(EnginePaths.TemplatesDir))
        {
            var fileName = Path.GetFileName(file);
            var destPath = Path.Combine(EnginePaths.TemplateTargetDir, fileName);
            
            // 템플릿은 항상 최신 코드를 덮어쓰도록 처리
            File.Copy(file, destPath, overwrite: true);
            Console.WriteLine($"[공장] 부품 조립 완료: {fileName}");
            count++;
        }

        return count;
    }
}