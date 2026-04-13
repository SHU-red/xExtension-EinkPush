import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

const output = fs.createWriteStream('xExtension-EinkPush.zip');
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => console.log('✅ Package created: xExtension-EinkPush.zip'));
archive.pipe(output);

const filesToInclude = [
    'Controllers', 'i18n', 'static', 'views', 'readability-api',
    'FreshExtension_EinkPush_Helper.php', 'extension.php', 
    'configure.phtml', 'metadata.json', 'LICENSE', 'README.md', 'CHANGELOG.md'
];

filesToInclude.forEach(file => {
    if (fs.lstatSync(file).isDirectory()) {
        archive.directory(file, `xExtension-EinkPush/${file}`);
    } else {
        archive.file(file, { name: `xExtension-EinkPush/${file}` });
    }
});

archive.finalize();
