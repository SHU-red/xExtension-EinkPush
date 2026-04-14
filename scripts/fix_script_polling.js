import fs from 'fs';
let c = fs.readFileSync('static/script.js', 'utf8');

// Replace pollCookie
c = c.replace(
    /function pollCookie\(\) \{[\s\S]*?\}\n/m,
    `function pollCookie(expectedSources = []) {
        if (expectedSources.length > 0) {
            let allDone = true;
            expectedSources.forEach(src => {
                if (document.cookie.indexOf('ep_dl_' + src + '=1') === -1) {
                    allDone = false;
                }
            });
            if (allDone) {
                expectedSources.forEach(src => {
                    document.cookie = 'ep_dl_' + src + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                });
                hideLoading();
            } else {
                setTimeout(() => pollCookie(expectedSources), 1000);
            }
        } else {
            if (document.cookie.indexOf('ep_dl_complete=1') !== -1) {
                document.cookie = 'ep_dl_complete=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                hideLoading();
            } else {
                setTimeout(() => pollCookie(), 1000);
            }
        }
    }\n`
);

// Replace "Download all enabled" logic
c = c.replace(
    /let delay = 0;\n\s*enabledSources\.forEach\(input => \{[\s\S]*?setTimeout\(hideLoading, delay \+ 2000\);\n\s*return;/m,
    `let delay = 0;
            let expectedSources = [];
            enabledSources.forEach(input => {
                const match = input.name.match(/sources\\[(.*?)\\]/);
                if (match && match[1]) {
                    const sourceKey = match[1];
                    expectedSources.push(sourceKey);
                    const url = dlAllBtn.href + '&source=' + encodeURIComponent(sourceKey) + '&silent=1';
                    setTimeout(() => {
                        console.log('[EinkPush] Triggering download for: ' + sourceKey);
                        const iframe = document.createElement('iframe');
                        iframe.style.display = 'none';
                        iframe.src = url;
                        document.body.appendChild(iframe);
                        setTimeout(() => iframe.remove(), 30000); // Increased iframe lifetime
                    }, delay);
                    delay += 1500;
                }
            });
            pollCookie(expectedSources);
            
            // Fallback timeout in case some downloads fail silently
            setTimeout(hideLoading, 60000);
            return;`
);

fs.writeFileSync('static/script.js', c);
