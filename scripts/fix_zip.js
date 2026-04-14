import fs from 'fs';
let c = fs.readFileSync('FreshExtension_EinkPush_Helper.php', 'utf8');
c = c.replace(
    /if \(\$zip->open\(\$fullPath, ZipArchive::CREATE \| ZipArchive::OVERWRITE\) !== true\) \{\s*return null;\s*\}/,
    '$zipRes = $zip->open($fullPath, ZipArchive::CREATE | ZipArchive::OVERWRITE);\n        if ($zipRes !== true) {\n            error_log(\'[EinkPush] Failed to create EPUB zip at \' . $fullPath . \'. Error code: \' . $zipRes);\n            return null;\n        }'
);
fs.writeFileSync('FreshExtension_EinkPush_Helper.php', c);
