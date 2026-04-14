import fs from 'fs';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'SHU-red/xExtension-EinkPush';

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
        const mergeRes = await fetch(`https://api.github.com/repos/${REPO}/merges`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                base: 'main',
                head: 'dev',
                commit_message: 'Merge dev into main for release'
            })
        });
        
        if (mergeRes.ok) {
            console.log("✅ Merged dev into main");
        } else {
            const err = await mergeRes.json();
            if (err.message === 'nothing to merge') {
                console.log("✅ Nothing to merge (dev and main are identical)");
            } else {
                console.error("❌ Failed to merge dev into main", err);
            }
        }
    } catch (e) {
        console.error(e);
    }
}
run();
