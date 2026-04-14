import fs from 'fs';
let c = fs.readFileSync('Controllers/EinkPushController.php', 'utf8');
c = c.replace(
    'setcookie(\'ep_dl_complete\', \'1\', time() + 60, \'/\');',
    '$sourceKey = Minz_Request::param(\'source\', \'unknown\');\n        setcookie(\'ep_dl_\' . $sourceKey, \'1\', time() + 60, \'/\');\n        setcookie(\'ep_dl_complete\', \'1\', time() + 60, \'/\');'
);
fs.writeFileSync('Controllers/EinkPushController.php', c);
