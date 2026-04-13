import fs from 'fs';
import { execSync } from 'child_process';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'SHU-red/xExtension-EinkPush'; // Hardcoded correct path

if (!GITHUB_TOKEN) {
    console.error('❌ GITHUB_TOKEN must be set.');
    process.exit(1);
}

const metadata = JSON.parse(fs.readFileSync('metadata.json', 'utf8'));
const version = metadata.version;
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');

console.log(`🚀 Releasing version ${version} to ${REPO}...`);

// 1. Create Release
const releaseResponse = await fetch(`https://api.github.com/repos/${REPO}/releases`, {
    method: 'POST',
    headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        tag_name: `v${version}`,
        name: `Release v${version}`,
        body: changelog,
        draft: false,
        prerelease: false
    })
});

if (!releaseResponse.ok) {
    console.error('❌ Failed to create release:', await releaseResponse.text());
    process.exit(1);
}

const release = await releaseResponse.json();
console.log(`✅ Release created: ${release.html_url}`);

// 2. Upload Zip
const zipPath = 'xExtension-EinkPush.zip';
if (fs.existsSync(zipPath)) {
    const zipData = fs.readFileSync(zipPath);
    const uploadResponse = await fetch(`${release.upload_url.split('{')[0]}?name=xExtension-EinkPush.zip`, {
        method: 'POST',
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Content-Type': 'application/zip',
            'Content-Length': zipData.length
        },
        body: zipData
    });

    if (!uploadResponse.ok) {
        console.error('❌ Failed to upload asset:', await uploadResponse.text());
        process.exit(1);
    }
    console.log('✅ Asset uploaded.');
} else {
    console.error('❌ Zip file not found. Run "npm run release" first.');
}
