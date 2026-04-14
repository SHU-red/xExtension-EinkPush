import fs from 'fs';
import path from 'path';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'SHU-red/xExtension-EinkPush';
const BRANCH = 'dev';

function getAllFiles(dirPath, arrayOfFiles) {
    const files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];

    files.forEach(function(file) {
        const fullPath = path.join(dirPath, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git') {
                arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
            }
        } else {
            if (!file.endsWith('.zip') && file !== 'package-lock.json' && file !== 'cookies.txt') {
                arrayOfFiles.push(fullPath);
            }
        }
    });

    return arrayOfFiles;
}

async function run() {
    if (!GITHUB_TOKEN) {
        console.error("No token");
        process.exit(1);
    }

    const headers = {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
    };

    try {
        const refRes = await fetch(`https://api.github.com/repos/${REPO}/git/refs/heads/${BRANCH}`, { headers });
        const refData = await refRes.json();
        const latestCommitSha = refData.object.sha;

        const commitRes = await fetch(`https://api.github.com/repos/${REPO}/git/commits/${latestCommitSha}`, { headers });
        const commitData = await commitRes.json();
        const baseTreeSha = commitData.tree.sha;

        // Get all files recursively starting from current directory '.'
        const allFiles = getAllFiles('.');
        const treeItems = [];

        for (const file of allFiles) {
            // Remove leading './' or '.\'
            const relativePath = file.replace(/^[.\/]+/, '').replace(/^[.\\]+/, '');
            if (!relativePath) continue;
            
            const content = fs.readFileSync(file, 'utf8');
            const blobRes = await fetch(`https://api.github.com/repos/${REPO}/git/blobs`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ content, encoding: 'utf-8' })
            });
            const blobData = await blobRes.json();
            treeItems.push({
                path: relativePath.replace(/\\/g, '/'),
                mode: '100644',
                type: 'blob',
                sha: blobData.sha
            });
        }

        const treeRes = await fetch(`https://api.github.com/repos/${REPO}/git/trees`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems })
        });
        const treeData = await treeRes.json();

        const newCommitRes = await fetch(`https://api.github.com/repos/${REPO}/git/commits`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                message: 'Fix metadata.json format for FreshRSS',
                tree: treeData.sha,
                parents: [latestCommitSha]
            })
        });
        const newCommitData = await newCommitRes.json();

        const updateRefRes = await fetch(`https://api.github.com/repos/${REPO}/git/refs/heads/${BRANCH}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ sha: newCommitData.sha })
        });
        
        if (updateRefRes.ok) {
            console.log("✅ Pushed successfully");
        } else {
            console.error("❌ Failed to push", await updateRefRes.text());
        }
    } catch (e) {
        console.error(e);
    }
}
run();
