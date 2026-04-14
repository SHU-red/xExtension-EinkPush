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
        const refRes = await fetch(`https://api.github.com/repos/${REPO}/git/refs/heads/main`, { headers });
        const refData = await refRes.json();
        const sha = refData.object.sha;

        const createRes = await fetch(`https://api.github.com/repos/${REPO}/git/refs`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ ref: 'refs/heads/dev', sha })
        });
        
        if (createRes.ok) {
            console.log("✅ Created dev branch");
        } else {
            const err = await createRes.json();
            if (err.message === 'Reference already exists') {
                console.log("✅ dev branch already exists");
            } else {
                console.error("❌ Failed to create dev branch", err);
            }
        }
    } catch (e) {
        console.error(e);
    }
}
run();
