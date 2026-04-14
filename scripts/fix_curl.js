import fs from 'fs';
let c = fs.readFileSync('FreshExtension_EinkPush_Helper.php', 'utf8');
c = c.replace(
    /if \(\$httpCode >= 200 && \$httpCode < 300\) \{\s*\$success = true;\s*break;\s*\}/,
    'if ($httpCode >= 200 && $httpCode < 300) {\n                $success = true;\n                break;\n            }\n            $lastError = curl_error($ch);'
);
c = c.replace(
    /\$this->logPush\(\$sourceName, \$success, \$success \? 'HTTP ' \. \$httpCode : 'Failed after retries \(Last: ' \. \$httpCode \. '\)'\);/,
    '$this->logPush($sourceName, $success, $success ? \'HTTP \' . $httpCode : \'Failed after retries (Last: \' . $httpCode . ($lastError ? \' - \' . $lastError : \'\') . \')\');'
);
fs.writeFileSync('FreshExtension_EinkPush_Helper.php', c);
